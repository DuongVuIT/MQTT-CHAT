### 8.1 Mỗi kết nối được nhận diện bằng người dùng và thiết bị

Project hiện chưa có đăng nhập. Giao diện cho phép chọn một người dùng có sẵn. Mỗi kết nối được nhận diện bằng cặp `userId:deviceId`.

`userId` cho biết ai đang thực hiện hành động. `deviceId` phân biệt các trình duyệt hoặc điện thoại của cùng người dùng. Nhờ đó hệ thống biết một người còn trực tuyến trên thiết bị khác hay đã ngắt toàn bộ kết nối.

Khi đổi người dùng, ứng dụng đóng kết nối MQTT cũ, hủy các bộ hẹn giờ, xóa dữ liệu của người trước rồi tải lại dữ liệu cho người mới. Nếu không dọn đúng, danh sách cuộc trò chuyện hoặc tin đang chờ của người trước có thể xuất hiện trong phiên mới.

Mã nguồn liên quan: apps/web/src/app/chat/page.tsx · apps/mobile/src/hooks/useChatSession.ts

### 8.2 Chat riêng và chat nhóm có cách tạo khác nhau

Chat riêng dùng `directPairKey`, một khóa được tạo ổn định từ mã của hai người dùng. PostgreSQL không cho phép hai cuộc trò chuyện có cùng khóa này. Vì vậy hai yêu cầu tạo chat riêng xảy ra gần nhau vẫn dẫn đến một cuộc trò chuyện duy nhất.

Chat nhóm được tạo qua API. Phía máy chủ lưu nhóm, thành viên và vai trò trong cùng một giao dịch, sau đó ghi sự kiện vào Outbox để Web và Mobile cập nhật danh sách.

Quản trị viên nhóm có thể thêm hoặc xóa thành viên; thành viên có thể rời nhóm. Khi xóa nhóm, phía máy chủ ghi thời điểm vào `deletedAt` thay vì xóa ngay toàn bộ dữ liệu. Cách này gọi là xóa mềm: nhóm không còn xuất hiện và không nhận tin mới, nhưng lịch sử vẫn được bảo toàn.

Mã nguồn liên quan: apps/api/src/controllers · packages/database/prisma/schema.prisma

### 8.3 Trả lời, sửa, xóa và thả cảm xúc đều được phía máy chủ kiểm tra

Khi trả lời một tin nhắn, yêu cầu mang theo `replyToId`. `chat-worker` kiểm tra tin được trả lời có tồn tại và có thuộc cùng cuộc trò chuyện không.

Khi sửa hoặc xóa, phía máy chủ kiểm tra người thực hiện có quyền với tin nhắn. Sau khi thay đổi PostgreSQL, phía máy chủ phát `message.edited` hoặc `message.deleted`. Ứng dụng dùng mã tin nhắn do máy chủ cấp để sửa đúng bản ghi đang hiển thị.

Thả cảm xúc cũng đi theo cặp yêu cầu và sự kiện. PostgreSQL không cho phép cùng một người thêm trùng một biểu tượng cảm xúc trên cùng tin nhắn.

```text
Người dùng bấm 👍
→ gửi reaction.add
→ kiểm tra thành viên và tin nhắn
→ lưu MessageReaction và OutboxEvent
→ phát reaction.added
→ Web/Mobile cập nhật đúng tin nhắn
```

Mã nguồn liên quan: apps/chat-worker/src/handlers · packages/mqtt-contracts/src

### 8.4 Trực tuyến, đang nhập, đã nhận và đã đọc là bốn trạng thái khác nhau

| Trạng thái | Nó cho biết điều gì?                                 | Nơi xử lý chính                |
| ---------- | ---------------------------------------------------- | ------------------------------ |
| Trực tuyến | Người dùng còn ít nhất một thiết bị đang kết nối     | Redis và sự kiện MQTT          |
| Đang nhập  | Người dùng vừa nhập nội dung trong vài giây gần nhất | Redis với thời gian tự hết hạn |
| Đã nhận    | Thiết bị đã nhận liên tục đến số thứ tự nào          | `lastDeliveredSequence`        |
| Đã đọc     | Người dùng đã đọc liên tục đến số thứ tự nào         | `lastReadSequence`             |

Nếu kết nối mất bất thường, ứng dụng không thể chủ động báo đã ngắt. Khi kết nối, ứng dụng đã đăng ký trước một thông báo mất kết nối với EMQX, gọi là LWT. EMQX tự gửi thông báo này khi phát hiện thiết bị biến mất.

Mốc đã nhận và đã đọc chỉ tăng. Ví dụ `lastReadSequence = 120` nghĩa là các tin nhắn có số thứ tự từ 120 trở xuống đã được đọc; một sự kiện cũ không được làm giá trị này giảm xuống.

Mã nguồn liên quan: packages/redis/src · apps/chat-worker/src/handlers/receipts.ts

### 8.5 Gửi tệp gồm bước tải tệp và bước gửi tin nhắn

Nội dung tệp không đi qua MQTT. Web hoặc Mobile tải tệp lên API trước, nhận `storageKey` và thông tin mô tả, sau đó mới đưa các thông tin này vào yêu cầu `message.send`.

```text
Người dùng chọn tệp
  ├─ nội dung tệp ──→ tải lên qua HTTP ──→ MinIO
  │                                      │
  └──────────────── storageKey + thông tin
                                         │
                                         ▼
                                  message.send
                                         │
                                         ▼
                              Message + OutboxEvent
```

Người nhận thấy tin nhắn có loại ảnh, video, ghi âm hoặc tài liệu. Ứng dụng dùng loại tin và mã MIME để chọn cách hiển thị, rồi tải nội dung qua `/media`.

Nếu tải tệp lên thành công nhưng gửi tin nhắn thất bại, tệp đó chưa được coi là một tin nhắn đã gửi. Hệ thống cần có cơ chế dọn các tệp không còn được tham chiếu.

Mã nguồn liên quan: apps/web · apps/mobile · apps/api · packages/storage

### 8.6 Lệnh bắt đầu bằng dấu / được viết ngay trong ô chat

Tin nhắn chữ bắt đầu bằng ký tự `/` thường được gọi là slash command trong mã nguồn. Từ ngay sau dấu `/` là tên lệnh; phần còn lại là tham số nếu lệnh cần thêm thông tin. Ví dụ `/ping` có tên lệnh là `ping`.

Đây chỉ là quy ước đọc nội dung tin nhắn, không phải một giao thức hay kênh MQTT riêng. `chat-worker` vẫn lưu `/ping` như tin nhắn chữ thông thường rồi phát `message.created`.

`bot-worker` nhận sự kiện, đọc nội dung, tìm luật phù hợp và gửi yêu cầu `bot.send`. Yêu cầu này quay lại `chat-worker` để được kiểm tra, cấp số thứ tự và lưu như các tin nhắn khác.

```text
Tin nhắn chữ "/ping"
→ chat-worker lưu tin và phát message.created
→ bot-worker nhận ra lệnh ping
→ gửi bot.send
→ chat-worker lưu tin trả lời của bot
```

Theo mặc định, bot bỏ qua tin nhắn do bot khác tạo. Cùng với thời gian chờ giữa hai lần chạy và các mã lần theo luồng, quy tắc này ngăn bot tự kích hoạt lặp vô hạn.

Mã nguồn liên quan: packages/database/src/seed.ts · apps/bot-worker/src · apps/chat-worker/src/handlers/bot-send.ts
