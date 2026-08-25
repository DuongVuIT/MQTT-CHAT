### 3.1 Các chữ viết tắt xuất hiện nhiều lần

| Từ viết tắt | Nghĩa cần nhớ trong tài liệu                                       |
| ----------- | ------------------------------------------------------------------ |
| API         | Các đường dẫn để ứng dụng lấy hoặc thay đổi dữ liệu ở phía máy chủ |
| HTTP        | Cách gửi một yêu cầu và nhận một kết quả                           |
| MQTT        | Giao thức chuyển dữ liệu theo tên kênh giữa nhiều chương trình     |
| QoS         | Mức MQTT bảo đảm dữ liệu được giao                                 |
| ID          | Mã dùng để nhận diện một đối tượng                                 |
| TTL         | Thời gian dữ liệu được phép tồn tại trước khi tự hết hạn           |
| LWT         | Thông báo EMQX tự gửi khi một kết nối mất bất thường               |
| MIME        | Mã cho biết tệp là ảnh, video, âm thanh hay tài liệu               |

Tên đầy đủ bằng tiếng Anh không cần ghi nhớ để theo dõi kiến trúc. Điều quan trọng là biết mỗi thuật ngữ đang chỉ loại dữ liệu hoặc trách nhiệm nào.

### 3.2 MQTT chuyển dữ liệu theo kênh thay vì gọi thẳng từng máy

MQTT là giao thức truyền tin theo mô hình gửi và đăng ký nhận. Bên gửi đưa dữ liệu vào một kênh có tên; EMQX tìm những bên đã đăng ký kênh phù hợp rồi chuyển dữ liệu cho họ.

| Thuật ngữ                  | Cách hiểu trong dự án                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| Publish — gửi              | Đưa dữ liệu vào một kênh MQTT                                                |
| Subscribe — đăng ký nhận   | Yêu cầu EMQX chuyển những dữ liệu thuộc kênh quan tâm                        |
| Topic — tên kênh           | Chuỗi dùng để phân loại và định tuyến, ví dụ `chat/v1/commands/message/send` |
| Broker — máy chủ MQTT      | Nhận, so khớp tên kênh và chuyển dữ liệu                                     |
| QoS — mức bảo đảm giao tin | Quy định MQTT có cần xác nhận và gửi lại hay không                           |

QoS 0 gửi nhanh nhưng không thử lại khi mất gói, phù hợp với trạng thái đang nhập vì dữ liệu này hết giá trị rất nhanh. QoS 1 yêu cầu xác nhận và có thể gửi lại, phù hợp với yêu cầu tạo tin nhắn; vì có thể nhận trùng nên bên xử lý phải chống trùng.

Mã nguồn liên quan: packages/mqtt-contracts/src/topics.ts · packages/mqtt-contracts/src/qos.ts

### 3.3 EMQX nhận, định tuyến và chuyển dữ liệu MQTT

EMQX là máy chủ MQTT của hệ thống. Nó giữ các kết nối, ghi nhận bên nào đang đăng ký kênh nào và chuyển dữ liệu theo tên kênh cùng mức QoS.

Ví dụ, Web gửi `message.send` vào kênh dành cho yêu cầu gửi tin nhắn. `chat-worker` đã đăng ký kênh đó nên EMQX chuyển yêu cầu tới chương trình này. Sau khi phía máy chủ xử lý xong, sự kiện `message.created` được gửi lên kênh sự kiện để Web, Mobile, bot và dịch vụ thông báo nhận.

Khi chạy nhiều `chat-worker`, chúng dùng đăng ký dùng chung. EMQX chọn một chương trình xử lý mỗi yêu cầu, thay vì gửi cùng yêu cầu cho tất cả.

EMQX không kiểm tra người dùng có thuộc cuộc trò chuyện không, không cấp số thứ tự và không lưu lịch sử chat. Những việc đó do `chat-worker` và PostgreSQL thực hiện.

Mã nguồn liên quan: packages/mqtt/src · packages/mqtt-contracts/src/topics.ts · apps/chat-worker/src/worker.ts

### 3.4 HTTP, WebSocket và MQTT có vai trò khác nhau

| Công nghệ | Dùng khi nào?                                                                  |
| --------- | ------------------------------------------------------------------------------ |
| HTTP      | Ứng dụng hỏi và nhận một kết quả, ví dụ lấy lịch sử, tạo nhóm hoặc tải tệp lên |
| WebSocket | Giữ một kết nối hai chiều mở lâu giữa ứng dụng và máy chủ                      |
| MQTT      | Đặt quy tắc gửi, nhận, tên kênh và mức bảo đảm trên kết nối đó                 |

Trên trình duyệt, MQTT chạy bên trong kết nối WebSocket. Gateway nhận kết nối tại `/mqtt` rồi chuyển nó đến EMQX. Vì vậy WebSocket là đường truyền, còn MQTT là cách các bên tổ chức dữ liệu đi trên đường truyền đó.

```text
Lấy dữ liệu hoặc tải tệp:
Web/Mobile ── HTTP ──→ Gateway ──→ API

Dữ liệu thời gian thực:
Web/Mobile ── MQTT qua WebSocket ──→ Gateway ──→ EMQX
```

Mã nguồn liên quan: apps/gateway/src/index.ts · apps/api/src · packages/mqtt

### 3.5 Yêu cầu và sự kiện chính thức không phải cùng một loại dữ liệu

Yêu cầu, trong mã nguồn gọi là command, diễn tả việc một bên muốn hệ thống thực hiện. `message.send` chỉ có nghĩa là ứng dụng muốn gửi tin nhắn; phía máy chủ vẫn có thể từ chối nếu dữ liệu sai hoặc người gửi không có quyền.

Sự kiện chính thức, trong mã nguồn gọi là canonical event, mô tả việc đã xảy ra sau khi phía máy chủ kiểm tra và lưu thành công. `message.created` có nghĩa là tin nhắn đã được tạo, đã có mã của máy chủ và số thứ tự trong cuộc trò chuyện.

```text
message.send
  yêu cầu: hãy tạo tin nhắn này
           ↓ kiểm tra và lưu
message.created
  kết quả: tin nhắn đã được tạo
```

Nếu yêu cầu không hợp lệ, phía máy chủ phát `message.rejected`. Web và Mobile không được tự phát `message.created`, vì chúng không phải nơi quyết định dữ liệu chính thức.

Mã nguồn liên quan: packages/mqtt-contracts/src/commands.ts · packages/mqtt-contracts/src/events.ts

### 3.6 Khung dữ liệu chung giúp mọi yêu cầu có đủ thông tin

Mỗi yêu cầu và sự kiện đều có phần dữ liệu riêng, nhưng cùng được đặt trong một khung chung, trong mã nguồn gọi là envelope. Khung này chứa phiên bản, loại dữ liệu, thời điểm tạo, người hoặc dịch vụ tạo và mã dùng để lần theo luồng xử lý.

| Trường                     | Mục đích                                          |
| -------------------------- | ------------------------------------------------- |
| `requestId` hoặc `eventId` | Nhận diện duy nhất một yêu cầu hoặc sự kiện       |
| `actor`                    | Người dùng và thiết bị đã gửi yêu cầu             |
| `origin`                   | Dịch vụ đã tạo sự kiện                            |
| `correlationId`            | Gom các bước thuộc cùng một luồng nghiệp vụ       |
| `causationId`              | Chỉ ra bước ngay trước đã tạo ra dữ liệu hiện tại |

Hai mã cuối đặc biệt hữu ích với bot: có thể lần từ tin nhắn người dùng, qua luật của bot, đến yêu cầu `bot.send` và tin nhắn trả lời.

Mã nguồn liên quan: packages/mqtt-contracts/src/envelope.ts · packages/mqtt-contracts/src/commands.ts · packages/mqtt-contracts/src/events.ts

### 3.7 Outbox tránh trường hợp đã lưu dữ liệu nhưng chưa phát sự kiện

Tạo tin nhắn cần làm hai việc: lưu vào PostgreSQL và gửi `message.created` lên EMQX. Hai hệ thống này không thể cùng hoàn tất trong một giao dịch. Nếu chương trình dừng sau khi lưu nhưng trước khi gửi sự kiện, dữ liệu trong cơ sở dữ liệu và màn hình người dùng sẽ không khớp.

Outbox là bảng chờ phát sự kiện trong PostgreSQL. `Message` và `OutboxEvent` được lưu trong cùng một giao dịch. Sau khi giao dịch hoàn tất, chương trình phát Outbox đọc sự kiện chưa gửi, chuyển nó lên EMQX rồi đánh dấu đã gửi.

```text
Một giao dịch PostgreSQL
├─ cập nhật số thứ tự của cuộc trò chuyện
├─ lưu Message
└─ lưu OutboxEvent
       ↓
chương trình phát Outbox → EMQX
```

Nếu EMQX tạm thời lỗi, sự kiện vẫn nằm trong Outbox để thử lại. Sự kiện có thể được gửi lặp, nên bên nhận vẫn phải nhận biết dữ liệu trùng.

Mã nguồn liên quan: apps/chat-worker/src/handlers/messages.ts · apps/chat-worker/src/outbox.ts
