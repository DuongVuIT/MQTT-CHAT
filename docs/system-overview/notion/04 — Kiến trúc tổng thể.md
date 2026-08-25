### 4.1 Gateway là cổng vào chung của hệ thống

Gateway chạy tại cổng 3000. Nó nhận yêu cầu từ Web hoặc Mobile, đọc đường dẫn rồi chuyển yêu cầu tới dịch vụ bên trong phù hợp.

| Đường dẫn bên ngoài    | Nơi nhận bên trong | Mục đích                                                |
| ---------------------- | ------------------ | ------------------------------------------------------- |
| `/`, `/chat`, `/admin` | Ứng dụng Web       | Hiển thị giao diện chat và quản trị                     |
| `/api/*`, `/media*`    | API                | Lấy dữ liệu, thay đổi dữ liệu, tải lên và tải xuống tệp |
| `/mqtt`                | EMQX               | Kết nối MQTT từ Web và Mobile                           |

```text
Web / Mobile
      │
      ▼
Gateway :3000
  ├─ trang Web ─────→ Next.js :3100
  ├─ API và media ──→ NestJS API :3001
  └─ MQTT ──────────→ EMQX :8083
```

Nhờ có Gateway, Web và Mobile chỉ cần biết một địa chỉ. Các cổng nội bộ của Web, API và EMQX không phải mở trực tiếp cho người dùng.

Mã nguồn liên quan: apps/gateway/src/index.ts · docker-compose.yml

### 4.2 API và các chương trình phía sau xử lý hai kiểu công việc

API xử lý theo cách hỏi và trả lời qua HTTP: ứng dụng gửi một yêu cầu rồi chờ kết quả trên cùng kết nối. Các chương trình phía sau nhận công việc từ MQTT hoặc từ cơ sở dữ liệu, nên không cần giữ một yêu cầu HTTP đang chờ.

| Thành phần            | Nhận gì?                              | Làm gì?                                                    |
| --------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Gateway               | HTTP và WebSocket từ Web/Mobile       | Chuyển kết nối tới đúng dịch vụ                            |
| API                   | Yêu cầu HTTP                          | Lịch sử, nhóm chat, thành viên, tệp, bot và trang quản trị |
| `chat-worker`         | Yêu cầu chat qua MQTT                 | Kiểm tra quyền, cấp số thứ tự và lưu thay đổi              |
| `bot-worker`          | Sự kiện đã được phía máy chủ xác nhận | Kiểm tra luật và tạo yêu cầu trả lời của bot               |
| `notification-worker` | Sự kiện tin nhắn mới                  | Tạo thông báo khi người nhận không trực tuyến              |

API và `chat-worker` đều có thể thay đổi PostgreSQL, nhưng phục vụ hai luồng khác nhau. Các thao tác cần kết quả HTTP trực tiếp đi qua API; yêu cầu chat thời gian thực đi qua `chat-worker`.

Mã nguồn liên quan: apps/api · apps/chat-worker · apps/bot-worker · apps/notification-worker

### 4.3 Yêu cầu đi vào; kết quả chính thức đi ra

Web hoặc Mobile gửi yêu cầu qua EMQX. `chat-worker` nhận yêu cầu, kiểm tra và lưu dữ liệu. Cùng lúc, chương trình này ghi một sự kiện vào Outbox. Sau khi dữ liệu đã lưu chắc chắn, chương trình phát Outbox chuyển sự kiện chính thức lên EMQX để các bên liên quan nhận.

```text
Web / Mobile
    │ message.send — yêu cầu gửi tin
    ▼
   EMQX
    ▼
chat-worker ──→ PostgreSQL
                    ├─ Message
                    └─ OutboxEvent
                           │
                           ▼
                    chương trình phát Outbox
                           │ message.created
                           ▼
                          EMQX
                    ┌──────┼─────────┐
                    ▼      ▼         ▼
                   Web   Mobile   Bot/Thông báo
```

Bot cũng phải đi qua `chat-worker`. Khi muốn trả lời, `bot-worker` gửi `bot.send`; `chat-worker` vẫn kiểm tra, cấp số thứ tự, lưu vào PostgreSQL và phát `message.created`. Vì vậy tin nhắn của bot được quản lý giống tin nhắn của người dùng.

Mã nguồn liên quan: apps/chat-worker/src · apps/bot-worker/src/transport.ts
