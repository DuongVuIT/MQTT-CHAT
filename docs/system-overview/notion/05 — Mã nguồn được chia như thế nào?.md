### 5.1 Thư mục apps chứa chương trình; packages chứa phần dùng chung

Toàn bộ hệ thống nằm trong một kho mã nguồn. Thư mục `apps/` chứa các chương trình có thể chạy riêng. Thư mục `packages/` chứa những phần được nhiều chương trình dùng chung.

```text
MQTT-CHAT/
├─ apps/
│  ├─ web                 giao diện Web và trang /admin
│  ├─ mobile              ứng dụng iOS/Android
│  ├─ gateway             cổng truy cập chung
│  ├─ api                 API và xử lý media
│  ├─ chat-worker         xử lý yêu cầu chat và Outbox
│  ├─ bot-worker          xử lý luật và lịch chạy của bot
│  └─ notification-worker xử lý thông báo
├─ packages/
│  ├─ mqtt-contracts      tên kênh, mức QoS và cấu trúc dữ liệu MQTT
│  ├─ realtime-core       phần kết nối MQTT dùng chung cho Web/Mobile
│  ├─ database            cấu trúc PostgreSQL và Prisma
│  ├─ redis               quy tắc đặt khóa và thao tác Redis
│  ├─ storage             kết nối MinIO
│  └─ mqtt, config, logger, bot-sdk, bot-rules, ui
└─ scripts/               công cụ phát triển và vận hành
```

Ứng dụng được phép dùng các `packages`. Ngược lại, phần dùng chung không được phụ thuộc vào một ứng dụng cụ thể. Quy tắc này giúp tránh vòng phụ thuộc và giữ ranh giới giữa các phần rõ ràng.

Mã nguồn liên quan: pnpm-workspace.yaml · apps · packages

### 5.2 Tìm chức năng bằng cách lần theo đường đi của dữ liệu

| Muốn tìm hiểu                        | Nơi nên mở trước                                    |
| ------------------------------------ | --------------------------------------------------- |
| Web tạo yêu cầu và hiển thị tin nhắn | apps/web/src/app/chat/page.tsx · apps/web/src/store |
| Mobile quản lý một phiên chat        | apps/mobile/src/hooks/useChatSession.ts             |
| Đường dẫn API                        | apps/api/src/controllers                            |
| Nơi nhận yêu cầu MQTT                | apps/chat-worker/src/worker.ts                      |
| Quy tắc xử lý tin nhắn               | apps/chat-worker/src/handlers/messages.ts           |
| Cách phát sự kiện từ Outbox          | apps/chat-worker/src/outbox.ts                      |
| Tên kênh và cấu trúc dữ liệu MQTT    | packages/mqtt-contracts/src                         |
| Bảng và ràng buộc cơ sở dữ liệu      | packages/database/prisma/schema.prisma              |

```text
Thao tác trên giao diện
→ HTTP hoặc MQTT
→ nơi nhận yêu cầu
→ phần xử lý nghiệp vụ
→ nơi lưu dữ liệu
→ sự kiện chính thức
→ dữ liệu trên Web/Mobile
→ giao diện
```

Khi có lỗi hiển thị, dữ liệu có thể đã sai từ bước nhận yêu cầu, xử lý, lưu hoặc cập nhật Web/Mobile. Đi theo đường dữ liệu giúp xác định đúng bước bắt đầu sai thay vì chỉ sửa thành phần đang hiển thị lỗi.
