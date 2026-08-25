# MQTT Chat — Tổng quan hệ thống

Tài liệu dành cho người mới tiếp cận dự án. Nội dung đi theo đường đi của dữ liệu và giải thích thuật ngữ ngay tại nơi chúng xuất hiện.

## Mục lục có giải thích

1. Bắt đầu từ đâu và hệ thống giải quyết việc gì?
2. Hệ thống sử dụng công nghệ nào và để làm gì?
3. Các khái niệm cần biết trước khi đọc kiến trúc
4. Kiến trúc tổng thể
5. Mã nguồn được chia như thế nào?
6. Luồng gửi tin nhắn từ đầu đến cuối
7. Dữ liệu được lưu ở đâu?
8. Các chức năng chính hoạt động như thế nào?
9. Web và Mobile giữ dữ liệu trên màn hình ra sao?
10. Hệ thống tránh mất, trùng và sai thứ tự như thế nào?
11. Tổng kết và cách lần theo một tính năng

Hai mục đầu của Chương 1 cho biết từng chương trả lời câu hỏi gì.

---

## Chương 1 — Bắt đầu từ đâu và hệ thống giải quyết việc gì?

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

---

## Chương 2 — Hệ thống sử dụng công nghệ nào và để làm gì?

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

---

## Chương 3 — Các khái niệm cần biết trước khi đọc kiến trúc

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

---

## Chương 4 — Kiến trúc tổng thể

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

---

## Chương 5 — Mã nguồn được chia như thế nào?

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

---

## Chương 6 — Luồng gửi tin nhắn từ đầu đến cuối

### 6.1 Ứng dụng tạo bản ghi đang chờ rồi gửi message.send

Khi người dùng bấm Gửi, phần soạn tin tạo `clientMessageId` bằng `crypto.randomUUID()`. Mã này đại diện cho đúng một lần gửi, kể cả khi ứng dụng phải gửi lại do mất mạng.

Web thêm một `PendingMessage` vào Zustand. Bản ghi này chứa cuộc trò chuyện, nội dung, loại tin, thông tin trả lời hoặc tệp và trạng thái hiện tại.

| Trạng thái trong code | Ý nghĩa                                                        |
| --------------------- | -------------------------------------------------------------- |
| `queued`              | Đang xếp hàng vì kết nối MQTT chưa sẵn sàng                    |
| `pending`             | Đã bắt đầu gửi và đang chờ phía máy chủ trả kết quả            |
| `failed`              | Gửi không thành công hoặc phía máy chủ từ chối; có thể thử lại |

`PendingMessage` được hiển thị riêng để người dùng biết thao tác đã được ghi nhận. Nó chưa nằm trong danh sách `Message` chính thức vì chưa có mã máy chủ và số thứ tự.

Mã nguồn liên quan: apps/web/src/components/Composer.tsx · apps/web/src/store/chat-store.ts

### 6.2 realtime-core đóng gói yêu cầu và gửi qua EMQX

Dữ liệu `message.send` gồm `conversationId`, `clientMessageId`, loại tin, nội dung, `replyToId` và thông tin tệp. `realtime-core` đặt phần dữ liệu này vào khung yêu cầu chung, kiểm tra cấu trúc rồi gửi lên đúng kênh MQTT.

```text
Yêu cầu message.send
├─ version: phiên bản cấu trúc
├─ requestId: mã yêu cầu
├─ timestamp: thời điểm tạo
├─ actor: userId + deviceId
└─ data
   ├─ conversationId
   ├─ clientMessageId
   ├─ content / type
   └─ replyToId / thông tin tệp
```

EMQX nhận yêu cầu tại kênh `chat/v1/commands/message/send`. Nếu có nhiều `chat-worker`, EMQX chuyển yêu cầu cho một chương trình trong nhóm xử lý.

Mã nguồn liên quan: packages/realtime-core/src/index.ts · packages/mqtt-contracts/src/envelope.ts · packages/mqtt-contracts/src/topics.ts

### 6.3 chat-worker kiểm tra dữ liệu và quyền thực hiện

`worker.ts` đọc loại yêu cầu rồi chuyển `message.send` tới `handleMessageSend`. Phần xử lý kiểm tra:

- người gửi và thiết bị có đủ thông tin;
- dữ liệu có đúng cấu trúc đã quy định;
- cuộc trò chuyện tồn tại và chưa bị xóa;
- người gửi là thành viên của cuộc trò chuyện;
- `replyToId`, nếu có, thuộc cùng cuộc trò chuyện;
- `clientMessageId` đã được xử lý trước đó hay chưa.

Kiểm tra trên giao diện chỉ giúp người dùng thấy lỗi sớm. Phía máy chủ vẫn phải kiểm tra lại vì mọi dữ liệu từ Web/Mobile đều có thể sai hoặc đã bị thay đổi.

Nếu yêu cầu không hợp lệ, `chat-worker` phát `message.rejected` kèm `clientMessageId`. Ứng dụng dựa vào mã này để chuyển đúng bản ghi đang chờ sang trạng thái thất bại.

Mã nguồn liên quan: apps/chat-worker/src/worker.ts · apps/chat-worker/src/handlers/messages.ts

### 6.4 PostgreSQL cấp số thứ tự và lưu Message cùng OutboxEvent

Trong một giao dịch PostgreSQL, `chat-worker` tăng `Conversation.lastSequence`. Giá trị mới trở thành số thứ tự `Message.sequence`. Cùng giao dịch đó, chương trình lưu `Message` và `OutboxEvent` chứa sự kiện `message.created`.

```text
Một giao dịch
├─ tăng Conversation.lastSequence → số thứ tự mới
├─ tạo Message
│  ├─ mã do máy chủ cấp
│  ├─ clientMessageId
│  ├─ sequence
│  └─ nội dung / trả lời / thông tin tệp
└─ tạo OutboxEvent(message.created)
```

Cấp số thứ tự bằng phép tăng trực tiếp trong giao dịch giúp hai tin nhắn gửi gần như cùng lúc vẫn nhận hai số khác nhau. Ràng buộc duy nhất trên `clientMessageId` ngăn một lần gửi bị lưu thành hai tin nhắn.

Mã nguồn liên quan: apps/chat-worker/src/handlers/messages.ts · packages/database/prisma/schema.prisma

### 6.5 message.created thay bản ghi đang chờ bằng dữ liệu chính thức

Sau khi giao dịch hoàn tất, chương trình phát Outbox gửi `message.created` lên EMQX. Web nhận sự kiện, thêm hoặc cập nhật `Message` theo mã do máy chủ cấp và cập nhật thông tin cuộc trò chuyện.

Sự kiện cũng mang `clientMessageId`. Web dùng mã này để xóa đúng `PendingMessage` tương ứng. Vì danh sách đang chờ và danh sách chính thức được tách riêng, cùng một tin nhắn không bị hiển thị hai lần.

Mobile dùng cùng nguyên tắc: tạo một bản ghi đang chờ, nhận `message.created`, đối chiếu bằng `clientMessageId`, thêm tin nhắn chính thức rồi xóa bản ghi đang chờ. Khi thử gửi lại, Mobile giữ nguyên `clientMessageId`.

Nếu các số thứ tự cho thấy đang thiếu một đoạn, ứng dụng gọi API lịch sử để lấy các tin còn thiếu, sau đó ghép theo mã và số thứ tự.

Mã nguồn liên quan: apps/web/src/app/chat/page.tsx · apps/web/src/store/chat-store.ts · apps/mobile/src/features/messaging/message-lifecycle.ts

---

## Chương 7 — Dữ liệu được lưu ở đâu?

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

---

## Chương 8 — Các chức năng chính hoạt động như thế nào?

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

---

## Chương 9 — Web và Mobile giữ dữ liệu trên màn hình ra sao?

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

---

## Chương 10 — Hệ thống tránh mất, trùng và sai thứ tự như thế nào?

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

---

## Chương 11 — Tổng kết và cách lần theo một tính năng

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
