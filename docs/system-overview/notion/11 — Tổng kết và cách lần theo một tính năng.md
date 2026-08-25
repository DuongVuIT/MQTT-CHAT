### 11.1 Mỗi thành phần chịu trách nhiệm cho một phần rõ ràng

| Thành phần    | Trách nhiệm                                                         |
| ------------- | ------------------------------------------------------------------- |
| Gateway       | Cung cấp một địa chỉ chung và chuyển kết nối tới đúng dịch vụ       |
| API           | Xử lý lịch sử, nhóm chat, thành viên, tệp, bot và quản trị qua HTTP |
| EMQX          | Chuyển dữ liệu MQTT theo tên kênh và mức QoS                        |
| `chat-worker` | Kiểm tra yêu cầu chat và quyết định thay đổi nào được lưu           |
| PostgreSQL    | Lưu dữ liệu nghiệp vụ chính thức và Outbox                          |
| Redis         | Lưu trạng thái trực tuyến, đang nhập và dữ liệu ngắn hạn            |
| MinIO         | Lưu nội dung ảnh, video, ghi âm và tài liệu                         |
| Web/Mobile    | Giữ dữ liệu phục vụ hiển thị và đồng bộ theo phía máy chủ           |

```text
Web/Mobile gửi yêu cầu
→ EMQX chuyển tới chat-worker
→ chat-worker kiểm tra nghiệp vụ
→ PostgreSQL lưu thay đổi và Outbox
→ phía máy chủ phát sự kiện chính thức
→ Web/Mobile cập nhật màn hình
```

Điểm cần nhớ: EMQX chỉ chuyển dữ liệu. `chat-worker` mới kiểm tra quyền và quyết định kết quả. PostgreSQL mới là nơi lưu kết quả chính thức.

### 11.2 Khi có lỗi, kiểm tra theo đúng đường đi của dữ liệu

| Nhóm chức năng          | Đường nên kiểm tra                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Gửi/trả lời/cảm xúc     | Giao diện → realtime-core → mqtt-contracts → chat-worker → PostgreSQL/Outbox → dữ liệu ứng dụng |
| Nhóm/thành viên         | Web/Mobile → API → PostgreSQL/Outbox → sự kiện cuộc trò chuyện                                  |
| Trực tuyến/đang nhập    | Kết nối MQTT → chương trình xử lý → Redis → sự kiện → giao diện                                 |
| Đã nhận/đã đọc          | Yêu cầu từ ứng dụng → xử lý mốc sequence → sự kiện                                              |
| Tệp                     | Bộ chọn tệp → API tải lên → MinIO → thông tin trong Message → đường dẫn media                   |
| Bot                     | `message.created` → bot-worker → `bot.send` → chat-worker                                       |
| Web và Mobile khác nhau | Dữ liệu HTTP → sự kiện MQTT → nơi giữ dữ liệu → phần hiển thị                                   |

Thứ tự kiểm tra thực tế:

1. Dữ liệu đi vào có đúng cấu trúc và đúng người dùng không?
2. Phía máy chủ đã áp dụng quy tắc nào và trả lỗi gì?
3. PostgreSQL, Redis hoặc MinIO đang lưu gì?
4. Outbox có sự kiện chưa, sự kiện đã được gửi chưa?
5. Web/Mobile có đăng ký đúng kênh và nhận đúng dữ liệu không?
6. Dữ liệu trên ứng dụng đã thêm, cập nhật hoặc đối chiếu đúng chưa?
7. Thành phần giao diện có hiển thị đúng dữ liệu đó không?

Đi theo thứ tự này giúp tìm nơi dữ liệu bắt đầu sai, thay vì chỉ sửa phần cuối đang biểu hiện lỗi.

Mã nguồn liên quan: packages/mqtt-contracts · apps/chat-worker · packages/database · packages/realtime-core
