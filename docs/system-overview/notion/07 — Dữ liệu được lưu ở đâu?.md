### 7.1 PostgreSQL lưu dữ liệu nghiệp vụ cần tồn tại lâu dài

PostgreSQL là nơi lưu chính thức người dùng, cuộc trò chuyện, thành viên, tin nhắn, cảm xúc, mốc đã đọc, cấu hình bot và Outbox. Dữ liệu vẫn còn sau khi chương trình khởi động lại.

```text
User ──→ ConversationMember ──→ Conversation
                                      │
                                      ▼
                                   Message
                                  ├─ quan hệ trả lời
                                  └─ MessageReaction

Thay đổi nghiệp vụ ──→ OutboxEvent ──→ sự kiện MQTT
Bot ──→ BotRule / ScheduledJob / Logs
```

`ConversationMember` nối người dùng với cuộc trò chuyện và lưu vai trò, mốc đã nhận, mốc đã đọc. `Conversation` lưu loại chat riêng hoặc chat nhóm và số sequence cuối cùng. `Message` lưu người gửi, nội dung, loại tin, sequence, quan hệ trả lời và thông tin tệp.

Web và Mobile chỉ giữ một bản dữ liệu phục vụ hiển thị. Khi kết nối lại hoặc phát hiện thiếu số thứ tự, ứng dụng lấy lịch sử từ phía máy chủ để bổ sung.

Mã nguồn liên quan: packages/database/prisma/schema.prisma · packages/database/prisma/migrations

### 7.2 Redis lưu trạng thái thay đổi nhanh hoặc tự hết hạn

Redis đọc và ghi dữ liệu rất nhanh, đồng thời có thể tự xóa dữ liệu sau một khoảng thời gian. Hệ thống dùng Redis cho trạng thái ngắn hạn hoặc dữ liệu có thể tạo lại; lịch sử chat không chỉ được lưu ở Redis.

| Dữ liệu               | Cách sử dụng                                            |
| --------------------- | ------------------------------------------------------- |
| Trạng thái trực tuyến | Lưu danh sách thiết bị đang kết nối của từng người dùng |
| Trạng thái đang nhập  | Tự hết hạn sau vài giây nếu không được cập nhật         |
| Hỗ trợ tính chưa đọc  | Giúp lấy số tin chưa đọc nhanh hơn                      |
| Trạng thái bot        | Ghi nhớ luật đang chạy và thời điểm được phép chạy lại  |

TTL là thời gian một dữ liệu được phép tồn tại trong Redis. Trạng thái đang nhập chỉ có TTL vài giây; nếu ứng dụng mất kết nối mà không gửi “đã dừng nhập”, Redis vẫn tự xóa trạng thái cũ.

Trạng thái trực tuyến được theo dõi theo từng thiết bị. Một người dùng chỉ được coi là mất kết nối khi không còn thiết bị nào hoạt động.

Mã nguồn liên quan: packages/redis/src

### 7.3 MinIO lưu nội dung tệp; PostgreSQL lưu thông tin mô tả

Web hoặc Mobile tải tệp lên API bằng HTTP. API kiểm tra loại tệp, kích thước và các thông tin đi kèm trước khi lưu nội dung tệp vào MinIO. Sau khi lưu, API trả về `storageKey`, là mã dùng để tìm lại tệp.

```text
Nội dung tệp ── HTTP ──→ API ──→ MinIO
                                  │
                                  └─ storageKey

storageKey + tên tệp + loại + kích thước
             └─ message.send ──→ Message trong PostgreSQL

GET /media?key=... ──→ API ──→ nội dung tệp
```

PostgreSQL chỉ lưu `storageKey`, tên tệp, loại MIME — mã cho biết định dạng tệp — và kích thước. Phần dữ liệu thực của ảnh hoặc tài liệu không nằm trong MQTT và không được ghi trực tiếp vào bảng Message. Cách tách này giữ dữ liệu thời gian thực nhỏ và giúp nơi lưu tệp được quản lý độc lập.

Mã nguồn liên quan: apps/api/src · packages/storage/src/index.ts
