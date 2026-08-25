### 1.1 Năm chương đầu giúp hiểu hệ thống và nơi đặt mã nguồn

Phần đầu trả lời các câu hỏi cần biết trước khi đọc sâu vào luồng xử lý.

| Chương                | Câu hỏi được trả lời                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| 1. Bắt đầu từ đâu?    | Hệ thống có những phần nào và nguyên tắc quan trọng nhất là gì?              |
| 2. Công nghệ          | Mỗi công nghệ được dùng ở đâu và giải quyết việc gì?                         |
| 3. Khái niệm nền tảng | MQTT, EMQX, yêu cầu, sự kiện và Outbox là gì?                                |
| 4. Kiến trúc tổng thể | Web, Mobile, Gateway, API và các chương trình xử lý kết nối với nhau ra sao? |
| 5. Cấu trúc mã nguồn  | Cần mở thư mục nào khi muốn tìm một chức năng?                               |

Sau chương 5, người đọc đã có đủ bản đồ tổng thể để theo dõi một tin nhắn đi qua hệ thống mà không phải đoán vai trò của từng thành phần.

### 1.2 Sáu chương sau đi vào xử lý dữ liệu và cách kiểm tra lỗi

| Chương                        | Câu hỏi được trả lời                                                              |
| ----------------------------- | --------------------------------------------------------------------------------- |
| 6. Luồng gửi tin nhắn         | Từ lúc bấm Gửi đến khi các thiết bị nhận kết quả có những bước nào?               |
| 7. Nơi lưu dữ liệu            | PostgreSQL, Redis và MinIO lưu phần dữ liệu nào?                                  |
| 8. Các chức năng chính        | Nhóm chat, trả lời, cảm xúc, trạng thái trực tuyến, tệp và bot hoạt động thế nào? |
| 9. Dữ liệu trên Web và Mobile | Ứng dụng giữ tin đang gửi và đồng bộ lại sau khi mất mạng ra sao?                 |
| 10. Độ tin cậy                | Hệ thống chống trùng, giữ đúng thứ tự và tránh mất sự kiện thế nào?               |
| 11. Tổng kết                  | Khi có lỗi, nên kiểm tra dữ liệu theo thứ tự nào?                                 |

Tài liệu đi theo đúng đường đi của dữ liệu: thao tác trên giao diện → phía máy chủ xử lý → nơi lưu dữ liệu → sự kiện trả về ứng dụng.

### 1.3 Phạm vi của MQTT Chat

MQTT Chat là một kho mã nguồn chung viết bằng TypeScript, gồm ứng dụng Web, ứng dụng Mobile và các chương trình chạy phía máy chủ. Hệ thống hỗ trợ chat riêng, chat nhóm, trả lời tin nhắn, thả cảm xúc, gửi ảnh và tệp, trạng thái trực tuyến, trạng thái đang nhập, trạng thái đã nhận/đã đọc, bot tự động, thông báo và trang quản trị.

| Thành phần             | Trách nhiệm chính                                                   |
| ---------------------- | ------------------------------------------------------------------- |
| Web                    | Giao diện chat trên trình duyệt và trang quản trị                   |
| Mobile                 | Ứng dụng iOS và Android                                             |
| Gateway                | Địa chỉ chung để Web và Mobile truy cập giao diện, API, tệp và MQTT |
| API                    | Cung cấp dữ liệu qua HTTP, xử lý nhóm chat, lịch sử và tệp          |
| Các chương trình xử lý | Xử lý tin nhắn, bot và thông báo ở phía máy chủ                     |

Web và Mobile cần phản hồi nhanh, nhưng kết quả cuối cùng phải do phía máy chủ kiểm tra và xác nhận. Nhờ vậy các thiết bị cùng nhận một dữ liệu thống nhất.

Mã nguồn liên quan: apps/web · apps/mobile · apps/gateway · apps/api · apps/*-worker

### 1.4 Phía máy chủ quyết định dữ liệu chính thức

Khi người dùng gửi tin nhắn, ứng dụng tạo một bản ghi đang chờ trên thiết bị. Bản ghi này có `clientMessageId` để nhận diện lần gửi, nhưng chưa có mã tin nhắn và số thứ tự do máy chủ cấp.

Ứng dụng gửi yêu cầu `message.send`. `chat-worker` kiểm tra cấu trúc dữ liệu, quyền tham gia cuộc trò chuyện và tin nhắn được trả lời. Nếu hợp lệ, chương trình này lưu `Message` cùng `OutboxEvent` trong một giao dịch của PostgreSQL.

Sau khi lưu thành công, phía máy chủ phát `message.created`. Đây là sự kiện chính thức: nó cho biết tin nhắn đã tồn tại trong cơ sở dữ liệu, có mã do máy chủ cấp và đã được xếp thứ tự.

```text
Người dùng bấm Gửi
→ ứng dụng tạo bản ghi đang chờ
→ gửi yêu cầu message.send
→ chat-worker kiểm tra và lưu dữ liệu
→ phía máy chủ phát sự kiện message.created
→ Web và Mobile cập nhật bằng dữ liệu chính thức
```

Mã nguồn liên quan: apps/web/src/components/Composer.tsx · apps/chat-worker/src/handlers/messages.ts · packages/database/prisma/schema.prisma
