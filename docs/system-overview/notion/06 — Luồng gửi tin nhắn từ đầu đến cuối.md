### 6.1 Ứng dụng tạo bản ghi đang chờ rồi gửi message.send

Khi người dùng bấm Gửi, phần soạn tin tạo `clientMessageId` bằng `crypto.randomUUID()`. Mã này đại diện cho đúng một lần gửi, kể cả khi ứng dụng phải gửi lại do mất mạng.

Web thêm một `PendingMessage` vào Zustand. Bản ghi này chứa cuộc trò chuyện, nội dung, loại tin, thông tin trả lời hoặc tệp và trạng thái hiện tại.

| Trạng thái trong code | Ý nghĩa                                                        |
| --------------------- | -------------------------------------------------------------- |
| `queued`              | Đang xếp hàng vì kết nối MQTT chưa sẵn sàng                    |
| `pending`             | Đã bắt đầu gửi và đang chờ phía máy chủ trả kết quả            |
| `failed`              | Gửi không thành công hoặc phía máy chủ từ chối; có thể thử lại |

`PendingMessage` được hiển thị riêng để người dùng biết thao tác đã được ghi nhận. Nó chưa nằm trong danh sách `Message` chính thức vì chưa có mã máy chủ và số thứ tự.

Mã nguồn liên quan: apps/web/src/components/Composer.tsx · apps/web/src/store/chat-store.ts

### 6.2 realtime-core đóng gói yêu cầu và gửi qua EMQX

Dữ liệu `message.send` gồm `conversationId`, `clientMessageId`, loại tin, nội dung, `replyToId` và thông tin tệp. `realtime-core` đặt phần dữ liệu này vào khung yêu cầu chung, kiểm tra cấu trúc rồi gửi lên đúng kênh MQTT.

```text
Yêu cầu message.send
├─ version: phiên bản cấu trúc
├─ requestId: mã yêu cầu
├─ timestamp: thời điểm tạo
├─ actor: userId + deviceId
└─ data
   ├─ conversationId
   ├─ clientMessageId
   ├─ content / type
   └─ replyToId / thông tin tệp
```

EMQX nhận yêu cầu tại kênh `chat/v1/commands/message/send`. Nếu có nhiều `chat-worker`, EMQX chuyển yêu cầu cho một chương trình trong nhóm xử lý.

Mã nguồn liên quan: packages/realtime-core/src/index.ts · packages/mqtt-contracts/src/envelope.ts · packages/mqtt-contracts/src/topics.ts

### 6.3 chat-worker kiểm tra dữ liệu và quyền thực hiện

`worker.ts` đọc loại yêu cầu rồi chuyển `message.send` tới `handleMessageSend`. Phần xử lý kiểm tra:

- người gửi và thiết bị có đủ thông tin;
- dữ liệu có đúng cấu trúc đã quy định;
- cuộc trò chuyện tồn tại và chưa bị xóa;
- người gửi là thành viên của cuộc trò chuyện;
- `replyToId`, nếu có, thuộc cùng cuộc trò chuyện;
- `clientMessageId` đã được xử lý trước đó hay chưa.

Kiểm tra trên giao diện chỉ giúp người dùng thấy lỗi sớm. Phía máy chủ vẫn phải kiểm tra lại vì mọi dữ liệu từ Web/Mobile đều có thể sai hoặc đã bị thay đổi.

Nếu yêu cầu không hợp lệ, `chat-worker` phát `message.rejected` kèm `clientMessageId`. Ứng dụng dựa vào mã này để chuyển đúng bản ghi đang chờ sang trạng thái thất bại.

Mã nguồn liên quan: apps/chat-worker/src/worker.ts · apps/chat-worker/src/handlers/messages.ts

### 6.4 PostgreSQL cấp số thứ tự và lưu Message cùng OutboxEvent

Trong một giao dịch PostgreSQL, `chat-worker` tăng `Conversation.lastSequence`. Giá trị mới trở thành số thứ tự `Message.sequence`. Cùng giao dịch đó, chương trình lưu `Message` và `OutboxEvent` chứa sự kiện `message.created`.

```text
Một giao dịch
├─ tăng Conversation.lastSequence → số thứ tự mới
├─ tạo Message
│  ├─ mã do máy chủ cấp
│  ├─ clientMessageId
│  ├─ sequence
│  └─ nội dung / trả lời / thông tin tệp
└─ tạo OutboxEvent(message.created)
```

Cấp số thứ tự bằng phép tăng trực tiếp trong giao dịch giúp hai tin nhắn gửi gần như cùng lúc vẫn nhận hai số khác nhau. Ràng buộc duy nhất trên `clientMessageId` ngăn một lần gửi bị lưu thành hai tin nhắn.

Mã nguồn liên quan: apps/chat-worker/src/handlers/messages.ts · packages/database/prisma/schema.prisma

### 6.5 message.created thay bản ghi đang chờ bằng dữ liệu chính thức

Sau khi giao dịch hoàn tất, chương trình phát Outbox gửi `message.created` lên EMQX. Web nhận sự kiện, thêm hoặc cập nhật `Message` theo mã do máy chủ cấp và cập nhật thông tin cuộc trò chuyện.

Sự kiện cũng mang `clientMessageId`. Web dùng mã này để xóa đúng `PendingMessage` tương ứng. Vì danh sách đang chờ và danh sách chính thức được tách riêng, cùng một tin nhắn không bị hiển thị hai lần.

Mobile dùng cùng nguyên tắc: tạo một bản ghi đang chờ, nhận `message.created`, đối chiếu bằng `clientMessageId`, thêm tin nhắn chính thức rồi xóa bản ghi đang chờ. Khi thử gửi lại, Mobile giữ nguyên `clientMessageId`.

Nếu các số thứ tự cho thấy đang thiếu một đoạn, ứng dụng gọi API lịch sử để lấy các tin còn thiếu, sau đó ghép theo mã và số thứ tự.

Mã nguồn liên quan: apps/web/src/app/chat/page.tsx · apps/web/src/store/chat-store.ts · apps/mobile/src/features/messaging/message-lifecycle.ts
