# Warehouse Management

Ứng dụng quản lý kho hàng sử dụng Node.js, Express và MySQL, được triển khai bằng Docker Compose. Hệ thống tích hợp Nginx HTTPS, Prometheus, Grafana, cAdvisor, MySQL Exporter, Loki và Promtail.

## 1. Công nghệ sử dụng

- **Application:** Node.js, Express
- **Database:** MySQL 8
- **Reverse proxy / HTTPS:** Nginx
- **Monitoring:** Prometheus, Grafana, cAdvisor, MySQL Exporter
- **Logging:** Loki, Promtail
- **Deployment:** Docker, Docker Compose

## 2. Yêu cầu

- Docker Desktop đang chạy.
- Docker Compose v2.
- Git nếu cần clone mã nguồn.

## 3. Cấu hình môi trường

Tạo file `.env` từ mẫu:

```powershell
Copy-Item .env.example .env
```

Mở `.env` và đặt các giá trị bí mật riêng, đủ mạnh cho những biến được khai báo trong `.env.example`. Không đưa file `.env` lên GitHub.

Kiểm tra cấu hình Compose:

```powershell
docker compose config --quiet
```

Nếu lệnh không báo lỗi, cấu hình Compose đã được phân tích thành công.

## 4. Khởi chạy hệ thống

Build và khởi chạy các dịch vụ:

```powershell
docker compose up -d --build
```

Kiểm tra trạng thái:

```powershell
docker compose ps
```

Xem log ứng dụng:

```powershell
docker compose logs --tail=50 app
```

Dừng các dịch vụ:

```powershell
docker compose down
```

Lệnh trên không yêu cầu xóa các volume dữ liệu.

## 5. Các địa chỉ truy cập

| Dịch vụ | Địa chỉ |
|---|---|
| Ứng dụng qua HTTPS | https://localhost |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| cAdvisor | http://localhost:8085 |
| phpMyAdmin | http://localhost:8082 |
| Loki API | http://localhost:3100 |

Các cổng monitoring, phpMyAdmin và Loki được cấu hình bind vào `127.0.0.1` trong cấu hình hiện tại. Nginx công bố cổng HTTP 80 và HTTPS 443.

**Lưu ý:** HTTPS localhost đang dùng chứng chỉ tự ký. Trình duyệt có thể cảnh báo chứng chỉ; không sử dụng cấu hình chứng chỉ này như chứng chỉ TLS công khai cho môi trường production.

## 6. Monitoring với Prometheus và Grafana

Prometheus thu thập metrics từ các target:

- `prometheus`: metrics của Prometheus.
- `cadvisor`: metrics container.
- `mysql`: metrics từ MySQL Exporter.

Kiểm tra trạng thái target tại:

http://localhost:9090/api/v1/targets

Truy cập Grafana tại http://localhost:3001. Cấu hình datasource Prometheus và dashboard theo thiết lập của môi trường triển khai.

Một số metrics có thể dùng để kiểm tra:

- `mysql_up`
- `mysql_global_status_threads_connected`

`mysql_up = 1` cho biết exporter báo MySQL đang hoạt động tại thời điểm truy vấn.

## 7. Logging với Loki và Promtail

Luồng logging:

`Node.js application → Docker container logs → Promtail → Loki → Grafana Explore`

Trong Grafana Explore, chọn datasource Loki. Ví dụ truy vấn:

```logql
{job="docker"} |= "MySQL"
```

Tìm log khởi động ứng dụng:

```logql
{job="docker"} |= "Server đang chạy tại"
```

Kết quả phụ thuộc vào log thực tế còn được lưu và thời gian truy vấn.

## 8. Các biện pháp bảo mật đã cấu hình

- File `.env` được Git bỏ qua.
- Có `.env.example` để cung cấp mẫu biến môi trường.
- Node.js chạy trong Docker với user không phải root theo Dockerfile.
- Nginx ẩn phiên bản máy chủ.
- Tắt header `X-Powered-By` của Express.
- Chuyển hướng HTTP sang HTTPS.
- Cấu hình các header `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` và `Permissions-Policy`.
- Ứng dụng sử dụng tài khoản MySQL riêng với quyền `SELECT` và `INSERT` trên bảng `products`, theo cấu hình tài khoản đã thiết lập.

Các mục trên mô tả cấu hình đã thực hiện; cần rà soát thêm trước khi kết luận hệ thống đáp ứng toàn bộ yêu cầu hardening hoặc sẵn sàng production.

## 9. Lệnh kiểm tra nhanh

```powershell
docker compose config --quiet
docker compose ps
docker compose logs --tail=50 app
Invoke-RestMethod "http://localhost:9090/api/v1/targets"
curl.exe -k -I https://localhost/
```

Các lệnh này kiểm tra cấu hình, trạng thái dịch vụ, log ứng dụng, target monitoring và phản hồi HTTPS. Chúng không thay thế cho kiểm thử chức năng tổng thể.

## 10. Minh chứng triển khai

Lưu ảnh chụp màn hình thực tế trong `docs/evidence/`, ví dụ:

- `docker-compose-ps.png` — trạng thái các container.
- `https-security-headers.png` — phản hồi HTTPS và security headers.
- `prometheus-targets.png` — trạng thái các target.
- `grafana-dashboard.png` — dashboard monitoring.
- `loki-app-logs.png` — log ứng dụng truy vấn qua Loki.

Chỉ đánh dấu minh chứng hoàn thành sau khi ảnh đã được chụp và lưu thực tế.

## 11. Git và lịch sử thay đổi

Kiểm tra nhánh và lịch sử commit:

```powershell
git status
git log --oneline -10
```

Trước khi commit, xác nhận không có file `.env`, mật khẩu, token hoặc dữ liệu bí mật trong các file được đưa vào Git.

## 12. Giới hạn và công việc còn lại

- Xác minh các biến môi trường khi triển khai trên máy khác.
- Rà soát quyền và cấu hình bảo mật của tất cả container.
- Đánh giá các image tag và chính sách cập nhật.
- Lưu ảnh minh chứng monitoring, logging và HTTPS.
- Hoàn thiện báo cáo dựa trên kết quả thực tế.
- Thực hiện kiểm thử tổng thể ở giai đoạn riêng sau khi hoàn tất cấu hình và tài liệu.
