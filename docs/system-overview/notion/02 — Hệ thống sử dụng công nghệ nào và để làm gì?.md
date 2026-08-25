### 2.1 Công nghệ nền tảng để viết và quản lý mã nguồn

| Công nghệ   | Là gì?                                          | Dùng để làm gì trong dự án?                                                           |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| TypeScript  | Ngôn ngữ có hệ thống kiểm tra kiểu dữ liệu      | Báo lỗi khi các phần của hệ thống truyền sai kiểu dữ liệu trước khi chương trình chạy |
| Node.js 22+ | Môi trường chạy chương trình phía máy chủ       | Chạy Gateway, API, các chương trình xử lý và các tập lệnh hỗ trợ                      |
| pnpm        | Công cụ cài thư viện và quản lý nhiều dự án con | Liên kết các ứng dụng với thư viện dùng chung trong cùng kho mã nguồn                 |
| Turborepo   | Công cụ điều phối công việc trong kho mã nguồn  | Chạy build, kiểm tra kiểu và các lệnh khác theo đúng thứ tự phụ thuộc                 |

TypeScript kiểm tra mã nguồn trước khi chạy, nhưng không tự kiểm tra được dữ liệu từ HTTP, MQTT hoặc biến môi trường. Các dữ liệu đi từ bên ngoài vào vẫn được kiểm tra lúc chương trình chạy bằng Zod.

pnpm quản lý thư viện; Turborepo quản lý các lệnh cần chạy. Hai công cụ phục vụ hai mục đích khác nhau.

Mã nguồn liên quan: package.json · pnpm-workspace.yaml · turbo.json · tooling/typescript

### 2.2 Công nghệ của ứng dụng Web

| Công nghệ    | Vai trò trong Web                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Next.js      | Tổ chức các trang `/`, `/chat`, `/admin` và tạo bản Web để đưa vào sử dụng                      |
| React        | Chia giao diện thành các thành phần và cập nhật màn hình khi dữ liệu thay đổi                   |
| Zustand      | Giữ danh sách cuộc trò chuyện, tin nhắn, tin đang chờ và trạng thái trực tuyến trên trình duyệt |
| Tailwind CSS | Viết kiểu hiển thị, bố cục và cách giao diện thay đổi theo kích thước màn hình                  |

React chịu trách nhiệm hiển thị. Zustand giữ bản dữ liệu mà Web đang dùng. Next.js tổ chức ứng dụng Web. Ba phần này không quyết định tin nhắn nào được công nhận; quyết định đó vẫn thuộc phía máy chủ.

Mã nguồn liên quan: apps/web/package.json · apps/web/src/app · apps/web/src/store/chat-store.ts

### 2.3 Công nghệ của ứng dụng Mobile

Ứng dụng Mobile dùng React Native và có phần dự án riêng cho iOS và Android.

| Công nghệ       | Vai trò trong Mobile                                              |
| --------------- | ----------------------------------------------------------------- |
| React Native    | Viết phần lớn giao diện và xử lý dùng chung cho iOS/Android       |
| Hermes          | Chạy mã JavaScript của ứng dụng trên điện thoại                   |
| Metro           | Gom mã nguồn và thư viện thành gói mà ứng dụng Mobile có thể chạy |
| Gradle          | Biên dịch và đóng gói ứng dụng Android                            |
| Xcode/CocoaPods | Biên dịch ứng dụng và quản lý thư viện cho iOS                    |

Khi người dùng chọn ảnh hoặc tài liệu, React Native gọi bộ chọn tệp của hệ điều hành. Phần xử lý chat nhận tệp, tải nội dung lên API rồi gửi thông tin mô tả qua MQTT.

Mã nguồn liên quan: apps/mobile/package.json · apps/mobile/android · apps/mobile/ios · apps/mobile/metro.config.js

### 2.4 Công nghệ của API và lớp truy cập dữ liệu

| Công nghệ | Vai trò                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| NestJS    | Tổ chức các đường dẫn API, tách phần nhận yêu cầu và phần xử lý nghiệp vụ                       |
| Zod       | Kiểm tra dữ liệu nhận từ HTTP, MQTT, biến môi trường và cấu hình bot khi chương trình đang chạy |
| Prisma    | Đọc, ghi PostgreSQL bằng TypeScript và quản lý thay đổi cấu trúc cơ sở dữ liệu                  |

NestJS chủ yếu được dùng trong `apps/api`. Các chương trình xử lý là những tiến trình Node.js riêng, không chạy bên trong API.

Zod trả lời câu hỏi “dữ liệu vừa nhận có đúng cấu trúc không?”. Prisma trả lời câu hỏi “cần đọc hoặc ghi bảng nào trong PostgreSQL?”. Hai công cụ không thay thế nhau.

Mã nguồn liên quan: apps/api · packages/database · packages/mqtt-contracts · packages/config

### 2.5 Thư viện dùng để kết nối các dịch vụ

| Thư viện   | Kết nối tới đâu?   | Mục đích                                                                   |
| ---------- | ------------------ | -------------------------------------------------------------------------- |
| MQTT.js    | EMQX               | Kết nối MQTT, đăng ký kênh nhận tin, gửi dữ liệu và tự kết nối lại         |
| ioredis    | Redis              | Đọc và ghi trạng thái trực tuyến, đang nhập và trạng thái ngắn hạn của bot |
| Pino       | Hệ thống nhật ký   | Ghi nhật ký có cấu trúc để tìm theo dịch vụ, cuộc trò chuyện hoặc tin nhắn |
| http-proxy | Các dịch vụ nội bộ | Giúp Gateway chuyển HTTP và WebSocket đến đúng dịch vụ                     |

MQTT.js chỉ là thư viện kết nối; EMQX mới là máy chủ chuyển tin MQTT. Tương tự, ioredis là thư viện kết nối; Redis mới là nơi giữ dữ liệu.

Mã nguồn liên quan: packages/mqtt · packages/redis · packages/logger · apps/gateway

### 2.6 Hạ tầng lưu trữ và truyền dữ liệu

| Công nghệ      | Mục đích trong hệ thống                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| PostgreSQL     | Lưu lâu dài người dùng, cuộc trò chuyện, tin nhắn, cảm xúc, mốc đã đọc, Outbox và dữ liệu bot     |
| Redis          | Lưu dữ liệu cần truy cập nhanh hoặc tự hết hạn như trực tuyến, đang nhập và thời gian chờ của bot |
| EMQX           | Nhận và chuyển dữ liệu MQTT giữa Web/Mobile với các chương trình xử lý                            |
| MinIO          | Lưu phần dữ liệu thực của ảnh, video, ghi âm và tài liệu                                          |
| Docker Compose | Khởi chạy các dịch vụ hạ tầng trên máy phát triển với cấu hình thống nhất                         |

PostgreSQL giữ dữ liệu nghiệp vụ chính thức. Redis giữ trạng thái ngắn hạn. EMQX chuyển dữ liệu nhưng không quyết định nghiệp vụ. MinIO giữ tệp nhưng không lưu thứ tự tin nhắn.

Mã nguồn liên quan: docker-compose.yml · packages/database · packages/redis · packages/storage
