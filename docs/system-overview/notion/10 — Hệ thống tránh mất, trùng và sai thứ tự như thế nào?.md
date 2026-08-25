### 10.1 Gửi lại cùng một yêu cầu không tạo thêm dữ liệu

Với MQTT QoS 1, EMQX cố gắng giao dữ liệu ít nhất một lần. Khi chưa nhận được xác nhận, dữ liệu có thể được gửi lại. Web hoặc Mobile cũng có thể thử lại nếu mất mạng trước khi biết lần gửi trước đã thành công hay chưa.

Vì vậy hệ thống phải xử lý lặp mà vẫn cho cùng một kết quả. Tính chất này gọi là idempotency trong code và tài liệu kỹ thuật.

| Loại dữ liệu            | Cách tránh trùng                                                                 |
| ----------------------- | -------------------------------------------------------------------------------- |
| Tin nhắn                | Mỗi lần gửi giữ nguyên `clientMessageId`; PostgreSQL không cho phép trùng mã này |
| Cảm xúc                 | Một người không thể thêm trùng cùng emoji trên một tin nhắn                      |
| Mốc đã nhận/đã đọc      | Chỉ nhận giá trị lớn hơn hiện tại                                                |
| Dữ liệu trên Web/Mobile | Có mã rồi thì cập nhật, chưa có mới thêm                                         |

`clientMessageId` được tạo trước khi gửi. Phía máy chủ dùng nó để nhận ra yêu cầu đã xử lý; ứng dụng dùng nó để nối kết quả `message.created` với đúng bản ghi đang chờ.

Mã nguồn liên quan: packages/database/prisma/schema.prisma · apps/web/src/store · apps/mobile/src/features

### 10.2 Số sequence tạo một thứ tự chung trong mỗi cuộc trò chuyện

Thứ tự gói tin đến thiết bị không luôn là thứ tự tin nhắn. Kết nối lại, gửi lại hoặc độ trễ mạng có thể làm sự kiện đến muộn hay đảo vị trí.

Mỗi cuộc trò chuyện có `lastSequence`. Khi tạo tin nhắn, `chat-worker` tăng giá trị này trong giao dịch và gán số mới cho `Message.sequence`. Vì vậy thứ tự cuối cùng do phía máy chủ quyết định, không phụ thuộc gói nào đến thiết bị trước.

```text
Thứ tự máy chủ cấp:  120 → 121 → 122
Thứ tự thiết bị nhận: 122 → 121
Thứ tự hiển thị:      121 → 122
```

Nếu ứng dụng đang có 120 nhưng nhận 122, nó biết đang thiếu 121. Ứng dụng gọi API lịch sử để lấy dữ liệu sau mốc 120. Sắp xếp giải quyết việc đến sai thứ tự; gọi lại lịch sử giải quyết việc thiếu dữ liệu.

Mã nguồn liên quan: apps/chat-worker/src/handlers/messages.ts · packages/realtime-core/src

### 10.3 Outbox bảo vệ khoảng giữa lúc lưu dữ liệu và phát sự kiện

PostgreSQL và EMQX là hai hệ thống riêng. Nếu `Message` đã được lưu nhưng chương trình dừng trước khi gửi `message.created`, người đang trực tuyến sẽ không biết có tin nhắn mới.

Outbox giải quyết bằng cách lưu `Message` và `OutboxEvent` trong cùng một giao dịch PostgreSQL. Một chương trình riêng đọc các sự kiện chưa gửi, chuyển chúng lên EMQX rồi ghi lại thời điểm đã gửi.

```text
Bắt đầu giao dịch
  lưu Message
  lưu OutboxEvent
Hoàn tất giao dịch
        ↓
chương trình phát Outbox
  gửi sự kiện → EMQX
  ghi thời điểm đã gửi
```

Nếu EMQX tạm thời lỗi, `OutboxEvent` vẫn còn để thử lại. Nếu sự kiện đã gửi nhưng chưa kịp ghi thời điểm, nó có thể được gửi lần nữa; vì vậy bên nhận vẫn cần cơ chế chống trùng.

Mã nguồn liên quan: apps/chat-worker/src/outbox.ts · packages/database/prisma/schema.prisma

### 10.4 Khi kết nối lại, MQTT và HTTP cùng phục hồi dữ liệu

| Tình huống                         | Hệ thống xử lý thế nào?                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| Mất mạng trước khi gửi             | Giữ yêu cầu đang chờ và thử lại bằng cùng `clientMessageId` |
| Mất mạng ngay sau khi gửi          | Chờ sự kiện chính thức hoặc hỏi lại lịch sử                 |
| Nhận sự kiện lặp                   | Cập nhật theo mã thay vì thêm một bản ghi mới               |
| Nhận sự kiện trễ                   | Sắp tin nhắn theo số sequence                               |
| Thiếu một đoạn sequence            | Gọi API lấy phần lịch sử sau mốc cuối cùng                  |
| Chương trình xử lý dừng giữa chừng | EMQX có thể giao lại yêu cầu chưa được xác nhận             |
| EMQX lỗi sau khi PostgreSQL đã lưu | Outbox giữ sự kiện để gửi lại                               |

Khi được yêu cầu dừng, chương trình ngừng nhận việc mới, chờ phần đang xử lý kết thúc rồi mới đóng MQTT, Redis và PostgreSQL. Trong tài liệu kỹ thuật, cách dừng có thứ tự này gọi là graceful shutdown; mục đích là tránh bỏ dở thay đổi giữa chừng.

Mã nguồn liên quan: apps/chat-worker/src/index.ts · apps/chat-worker/src/worker.ts · packages/mqtt/src
