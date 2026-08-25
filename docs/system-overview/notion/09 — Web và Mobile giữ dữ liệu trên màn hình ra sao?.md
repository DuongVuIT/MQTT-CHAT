### 9.1 Ứng dụng đăng ký nhận sự kiện trước khi tải dữ liệu ban đầu

Khi mở ứng dụng, Web hoặc Mobile kết nối MQTT và đăng ký các kênh cần nhận trước. Chỉ sau khi EMQX xác nhận đăng ký xong, ứng dụng mới gọi API để lấy danh sách cuộc trò chuyện và lịch sử ban đầu.

Nếu tải lịch sử trước rồi mới đăng ký MQTT, một sự kiện xuất hiện ở khoảng giữa hai bước có thể bị bỏ lỡ. Vì vậy những sự kiện đến trong lúc API đang tải được giữ tạm, rồi ghép vào dữ liệu ban đầu khi API trả về.

```text
Kết nối MQTT
→ đăng ký các kênh sự kiện
→ giữ tạm sự kiện mới
→ tải dữ liệu ban đầu bằng HTTP
→ ghép theo mã và số thứ tự
→ tiếp tục nhận dữ liệu thời gian thực
```

Khi ghép, ứng dụng không chỉ nối hai danh sách. Nếu mã tin nhắn đã có thì cập nhật, nếu chưa có mới thêm, sau đó sắp theo số thứ tự do phía máy chủ cấp.

Mã nguồn liên quan: packages/realtime-core/src · apps/web/src/app/chat/page.tsx

### 9.2 Tin đang gửi có vòng đời riêng trên Web và Mobile

Web giữ `PendingMessage` trong Zustand; Mobile giữ bản ghi tương tự trong `MessageLifecycleStore`. Bản ghi đang chờ chứa `clientMessageId`, cuộc trò chuyện, nội dung, thông tin tệp hoặc trả lời và trạng thái gửi.

| Trạng thái   | Người mới cần hiểu                                   |
| ------------ | ---------------------------------------------------- |
| `queued`     | Chưa gửi được vì kết nối chưa sẵn sàng               |
| `pending`    | Đã bắt đầu gửi và đang chờ phía máy chủ xác nhận     |
| `failed`     | Không gửi thành công; người dùng có thể thử lại      |
| Đã đối chiếu | Đã nhận `message.created`; bản ghi đang chờ được xóa |

Khi `message.created` quay về, ứng dụng thêm hoặc cập nhật tin nhắn chính thức theo mã máy chủ, rồi dùng `clientMessageId` để xóa đúng bản ghi đang chờ. Đây là bước đối chiếu dữ liệu đã gửi với kết quả từ phía máy chủ.

Khi kết nối lại, ứng dụng đăng ký lại các kênh MQTT và gọi API lấy những tin nhắn sau số thứ tự cuối cùng đang có. MQTT mang sự kiện mới; HTTP bổ sung phần lịch sử bị thiếu trong thời gian mất kết nối.

Mã nguồn liên quan: apps/web/src/store/chat-store.ts · apps/mobile/src/features/messaging · packages/realtime-core/src

### 9.3 Web và Mobile dùng chung quy tắc nhưng có cách quản lý riêng

| Phần            | Web                                        | Mobile                                                 |
| --------------- | ------------------------------------------ | ------------------------------------------------------ |
| Giao diện       | Next.js và React trong trình duyệt         | React Native trên iOS/Android                          |
| Nơi giữ dữ liệu | Zustand và các hàm của trang chat          | `useChatSession` và phần quản lý trạng thái gửi        |
| Kết nối MQTT    | WebSocket qua Gateway `/mqtt`              | WebSocket gắn với trạng thái mạng và vòng đời ứng dụng |
| Chọn tệp        | Bộ chọn tệp của trình duyệt                | Bộ chọn ảnh hoặc tài liệu của điện thoại               |
| Kết nối lại     | Thực hiện khi mạng hoặc WebSocket quay lại | Thực hiện khi mạng quay lại hoặc ứng dụng mở lại       |

Hai ứng dụng dùng chung tên kênh, cấu trúc dữ liệu MQTT và phần kết nối cơ bản. Tuy nhiên chúng không dùng chung toàn bộ nơi giữ dữ liệu vì trình duyệt và ứng dụng điện thoại có vòng đời khác nhau.

Khi lỗi chỉ xảy ra trên một nền tảng, cần kiểm tra: dữ liệu từ giao diện, bản ghi đang chờ, yêu cầu đã gửi, sự kiện đã nhận, bước đối chiếu và cuối cùng là phần hiển thị.

Mã nguồn liên quan: apps/web · apps/mobile · packages/realtime-core
