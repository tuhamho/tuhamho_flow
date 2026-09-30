# tuhamho_flow

Tiện ích Chrome Manifest V3 có giao diện tiếng Việt mang tên tuhamho_flow. Tiện ích chạy lần lượt prompt tạo ảnh trên ChatGPT hoặc prompt ảnh/video trên Google Flow, rồi lưu kết quả vào thư mục con trong thư mục tải xuống của Chrome. Không cần cài thư viện, chạy máy chủ hoặc thực hiện bước build.

Giao diện dùng nền tối tím, logo và hàng đợi. Icon extension và logo panel được tạo từ ảnh `AppIcon-1024.png` do người dùng cung cấp, ở các kích thước 16, 48 và 128 pixel. Chọn **Google Flow** hoặc **ChatGPT** trên panel. ChatGPT hiện chỉ tạo ảnh; Flow hỗ trợ ảnh/video. Chọn tab và thời gian chờ trong **Tùy chọn bổ sung**. Tiện ích dùng DOM, không dùng debugger.

## Cài ở chế độ nhà phát triển

1. Dùng Chrome 116 trở lên, mở `chrome://extensions`.
2. Bật **Chế độ nhà phát triển**.
3. Bấm **Tải tiện ích đã giải nén**, chọn chính thư mục chứa `manifest.json` này (`toolggflow`).
4. Ghim tiện ích nếu muốn, bấm biểu tượng tiện ích để mở side panel. Icon dùng ảnh chân dung bạn cung cấp.
5. Tải lại các tab Flow hoặc ChatGPT đang mở để Chrome gắn content script mới.

Sau mỗi lần sửa mã, tải lại tiện ích tại `chrome://extensions` **và tải lại tab dịch vụ**. Không cần quyền `scripting` để tiêm mã.

Nếu Chrome hỏi quyền trang `flow.google.com` hoặc `chatgpt.com`, hãy cấp quyền để tiện ích nhận diện và điều khiển tab dịch vụ tương ứng. Sau đó tải lại tab đó. Các quyền này chỉ áp dụng cho Flow và ChatGPT, không phải mọi trang web.

## Cách dùng

1. Chọn **Google Flow** hoặc **ChatGPT** ở đầu panel. Mở dự án Flow (`flow.google.com/project/...` hoặc `labs.google/fx/.../tools/flow`) hoặc mở `chatgpt.com` và đăng nhập nếu cần.
2. Với Flow, chọn **Ảnh** hoặc **Video** cho khớp chế độ trên Flow; dùng 1 kết quả mỗi lượt và đảm bảo ô prompt hiện sẵn. Với ChatGPT, tiện ích gửi mỗi dòng kèm yêu cầu tạo một ảnh và dòng `Số thứ tự: N` để đối chiếu. Dòng này có thể ảnh hưởng đôi chút đến cách mô hình hiểu prompt; yêu cầu không vẽ dòng này vào ảnh được thêm vào tin nhắn. Chọn chế độ ChatGPT có thể tạo ảnh. ChatGPT không hỗ trợ video trong tiện ích.
3. Mở panel. Nếu có nhiều tab cùng dịch vụ, chọn đúng tab trong danh sách. Panel giữ nguyên tab đó suốt phiên. **Làm mới** chỉ kiểm tra kết nối, không tạo ảnh.
4. Dán prompt, mỗi dòng một prompt, hoặc chọn tệp `.txt` UTF-8 (tối đa 1 MB, nội dung tối đa 500.000 ký tự). Bỏ qua dòng trống; hỗ trợ LF, CRLF, CR và BOM. Mỗi phiên tối đa 500 prompt, mỗi prompt tối đa 10.000 ký tự.
5. Nếu muốn bắt đầu tại vị trí cụ thể, nhập số ở **Bắt đầu từ prompt số** (ví dụ `40` hoặc `99`). Các mục trước đó được đánh dấu bỏ qua; mục đã hoàn tất ở vị trí này trở lên sẽ được chạy lại. Để trống, tiện ích tự tiếp tục từ mục chưa hoàn tất. Chọn **Tên file** (mặc định `tuhamho`) và **Thư mục lưu (trong Downloads)** (mặc định `tuhamho_flow`). Bật/tắt đánh số để đặt tên dạng `001_tuhamho.png`, `002_tuhamho.png`; nếu tắt đánh số, tiện ích thêm mã lượt để tránh trùng tên. Chọn khoảng nghỉ và thời gian chờ kết quả trong **Tùy chọn bổ sung**. Ký tự không hợp lệ được thay thế; đường dẫn/tên mẫu hiện ngay dưới ô nhập. Không nhập đường dẫn tuyệt đối hay nhiều cấp thư mục.
6. Bấm **Bắt đầu** để gửi danh sách tới dịch vụ đã chọn và tải kết quả. Hành động dùng hạn mức tài khoản của dịch vụ. Sau khi hàng đợi báo bắt đầu, có thể đóng panel hoặc chuyển sang tab khác; giữ tab Flow/ChatGPT đang xử lý mở và tránh tạo nội dung thủ công trên tab đó.
7. Theo dõi prompt hiện tại, hàng đợi và số **hoàn thành**. Một mục chỉ hoàn thành sau khi Chrome xác nhận tệp tải xong. Khoảng nghỉ ngẫu nhiên được áp dụng sau mỗi tệp tải xong, trước prompt kế tiếp.
8. Bấm **Dừng** để ngừng chờ/nhập và không gửi prompt kế tiếp. Yêu cầu đã gửi cho dịch vụ có thể vẫn tiếp tục tạo ảnh; tiện ích không hủy tác vụ trên máy chủ. Lượt tải do phiên này khởi tạo sẽ được yêu cầu hủy nếu chưa hoàn tất; tệp đã tải xong không bị xóa.

Đóng panel hoặc chuyển sang tab khác **không dừng** hàng đợi: service worker điều phối các prompt và tải xuống; tab Flow/ChatGPT vẫn phải mở. Bộ theo dõi ảnh ChatGPT quan sát DOM toàn trang và không dựa vào kích thước hiển thị của ảnh để tương thích tab nền. Chrome vẫn có thể giới hạn tài nguyên tab nền; nếu Chrome tạm dừng/loại bỏ tab hoặc tiện ích bị dừng, hàng đợi có thể ngắt. Đóng/tải lại tab dịch vụ, chuyển dự án hoặc mất kết nối sẽ dừng phiên. Tiến độ được lưu cục bộ; khi mở panel lại, trạng thái đang chạy được khôi phục để theo dõi. Nếu Chrome hoặc máy thoát/ngủ và phiên nền bị gián đoạn, các mục đã xong vẫn được giữ; mục dở sẽ cần kiểm tra trước khi tiếp tục để tránh tạo trùng. Hàng đợi không tự chạy khi mở panel/trang hoặc khởi động Chrome. Khi có lỗi, cả hàng đợi dừng để tránh gán ảnh đến muộn cho prompt tiếp theo.

Ví dụ tên tệp: `Downloads/tuhamho_flow/001_tuhamho.png`, `002_tuhamho.png` hoặc `001_tuhamho.mp4`. Không đưa prompt vào tên tệp. Khi tắt đánh số, tên có mã lượt; Chrome cũng tự thêm hậu tố nếu tên trùng (`conflictAction: uniquify`). Đường dẫn gốc là thư mục tải xuống mặc định của Chrome, thường là Downloads; tiện ích không chọn một ổ đĩa tùy ý. Tiện ích yêu cầu `saveAs: false`, nhưng không thể ghi đè cài đặt Chrome **Hỏi vị trí lưu từng tệp trước khi tải xuống**. Để batch tải tự động mà không hiện cửa sổ Save As, mở `chrome://settings/downloads` và tắt tùy chọn này. Chính sách quản trị máy cũng có thể buộc hộp thoại xuất hiện.

## Quyền và quyền riêng tư

Danh sách quyền chính xác trong manifest:

| Quyền | Mục đích |
| --- | --- |
| `sidePanel` | Mở bảng điều khiển bên cạnh trang khi người dùng bấm biểu tượng tiện ích. |
| `storage` | Lưu prompt, tùy chọn và tiến độ hàng đợi trong `chrome.storage.local` trên máy, không đồng bộ tài khoản. |
| `downloads` | Tạo lượt tải ảnh/video bằng `chrome.downloads.download`, theo dõi hoàn tất/lỗi và hủy đúng lượt tải của phiên khi dừng. |
| Host `https://labs.google/*` và `https://flow.google.com/*` | Tìm tab Flow cũ/mới và chạy content script chỉ trên trang công cụ Flow. |
| Host `https://chatgpt.com/*` | Tìm tab ChatGPT và chạy content script trên giao diện ChatGPT để gửi prompt, nhận biết ảnh mới. Không chạy trên các trang OpenAI khác. |

Không xin `tabs`, `scripting`, `debugger`, `activeTab`, `cookies`, `webRequest`, `history`, `<all_urls>` hoặc quyền host của CDN ảnh. Các hàm `chrome.tabs` chỉ tìm/kiểm tra tab dịch vụ đã chọn và liên lạc với content script. Script ChatGPT chỉ chạy tại `chatgpt.com`; script Flow chỉ chạy tại đường dẫn công cụ Flow. Cả hai không chạy trong iframe.

- Không có máy chủ, analytics, quảng cáo, thư viện/font từ xa, `eval`, Function constructor hay mã làm rối. Mọi script và CSS đều cục bộ.
- Không dùng API để đọc cookie, mật khẩu, token, thông tin đăng nhập, lịch sử duyệt web hay nội dung toàn trang. Chỉ tìm editor/nút gửi và ảnh mới trong câu trả lời assistant; trên Flow chỉ kiểm tra thành phần cần cho quy trình tạo. URL tệp kết quả được chuyển tạm thời cho Chrome Downloads, không lưu hoặc ghi vào log.
- Chỉ **prompt, tùy chọn và trạng thái từng mục hàng đợi** được lưu trong `chrome.storage.local` (khóa `settings`, `queueState`) trên máy, không đồng bộ. Tiến độ gồm prompt, trạng thái và mô tả trạng thái; không lưu ảnh, URL kết quả, mã tải hay dữ liệu DOM. Khi bấm Bắt đầu/Tiếp tục, prompt được chuyển tới trang dịch vụ đã chọn. Dịch vụ đó xử lý prompt theo tài khoản đang đăng nhập; tiện ích không trích xuất thông tin xác thực.
- Với ảnh, tiện ích thử xuất pixel của **thẻ ảnh kết quả mới** sang PNG bằng canvas cục bộ. Nếu Chrome chặn do CORS, tiện ích chuyển đúng URL HTTPS của ảnh vừa hiển thị cho `chrome.downloads.download` và lưu vào thư mục con đã chọn. Không chụp màn hình. Nếu URL là ảnh xem trước, tệp tải có thể là ảnh xem trước; định dạng thực có thể khác đuôi đoán từ URL.
- Với video, tiện ích **không dùng thumbnail làm kết quả**. Nó đợi thẻ video sẵn sàng hoặc link tải MP4/WebM rõ ràng. `blob:`, `data:video` và HTTPS cùng origin Flow được thử đọc cục bộ (fetch đặt `credentials: "omit"`, cấm redirect); video ở URL HTTPS thuộc hạ tầng media Google được giao cho Chrome Downloads tải trực tiếp. Giới hạn 30 MB chỉ áp dụng cho đường truyền video qua data URL nội bộ, không áp dụng cho lượt tải HTTPS trực tiếp. Không gọi XMLHttpRequest, WebSocket hoặc máy chủ riêng.
- Với ChatGPT, tiện ích gửi prompt kèm câu yêu cầu tạo một ảnh, chờ ảnh mới trong câu trả lời assistant và gửi URL ảnh cho Chrome Downloads. ChatGPT có thể thay đổi giao diện, hỏi lại hoặc trả lời bằng văn bản; khi không tìm thấy ảnh, hàng đợi báo lỗi và không tự gửi lại. Chỉ hỗ trợ ảnh, không video.
- **Tải trực tiếp và cookie:** Chrome Downloads có thể dùng cookie miền tệp. Trên Flow, chỉ nhận URL HTTPS của miền media Google cho ảnh/video. Trên ChatGPT, chỉ nhận URL HTTPS của `chatgpt.com`, `openai.com`, `oaiusercontent.com`, `oaistatic.com` hoặc blob thuộc `chatgpt.com`. Tiện ích không đọc cookie, không xin quyền `cookies`, không thêm header xác thực và không gửi prompt tới miền media. Redirect ngoài danh sách, URL hết hạn hoặc chính sách dịch vụ có thể khiến tải thất bại.
- `downloads.onChanged` chỉ xử lý ID do phiên này tạo; `downloads.search({id})` chỉ đối chiếu đúng lượt tải đó để tránh bỏ sót sự kiện hoàn tất quá nhanh. Không truy vấn danh sách tệp tải khác. `downloads.cancel(id)` chỉ áp dụng cho lượt tải của phiên bị dừng/lỗi.
- Nút **Xóa prompt và tiến độ đã lưu** xóa prompt cùng hàng đợi khỏi giao diện và storage, giữ các tùy chọn khác. Gỡ tiện ích xóa storage của tiện ích. Ảnh đã lưu và dữ liệu/lịch sử tạo ảnh trên Google Flow không tự bị xóa.

## Nhập prompt bằng DOM, không debugger

Tiện ích ưu tiên setter DOM gốc cho textarea, `beforeinput` và lệnh chỉnh sửa DOM `document.execCommand('insertText')` cho contenteditable. Lệnh này chỉnh sửa văn bản, không thực thi mã JavaScript. Tiện ích kiểm tra lại **toàn bộ nội dung prompt** trước khi bấm nút tạo đúng một lần; không gửi thêm Enter hay tự thử lại.

Chrome không hiện cảnh báo debugger vì bản này không xin hoặc sử dụng debugger; không có debugger cần giải phóng khi dừng. Nếu Flow yêu cầu sự kiện nhập đáng tin cậy (`isTrusted`) hoặc editor không cập nhật state từ DOM, tiện ích báo lỗi hoặc hết thời gian chờ. Việc nhìn thấy đúng chữ trong editor không bảo đảm state nội bộ của Flow đã nhận. Không khẳng định nhập DOM ổn định trên mọi phiên bản Flow. Cần xác nhận vấn đề trên Flow thực tế trước khi cân nhắc một bản có debugger tùy chọn.

## Selector và giới hạn đã biết

Trong đầu `content.js`, khối `CONFIG` có:

- `promptSelector`: selector ô textarea/contenteditable. Mặc định tìm nhãn prompt/mô tả rồi Slate hoặc editor duy nhất đang hiện.
- `generateSelector`: selector đúng nút gửi/tạo. Mặc định dùng nhãn Việt/Anh và icon `arrow_forward`, ưu tiên cùng vùng với editor. Không bấm nút không nhãn chỉ vì ở gần. Nhiều ứng viên → báo lỗi.
- `resultSelector`: selector của **thẻ `img` kết quả** bên trong `main` (hoặc tài liệu nếu trang không có `main`). Mặc định lọc ảnh đã tải xong, đang hiển thị, cả hai chiều tối thiểu 256 pixel; bỏ vùng điều hướng và form/editor.
- `settleMs`, `pollMs`, `minImageSize`: độ ổn định và ngưỡng nhận ảnh. Thời gian chờ tối đa chỉnh trực tiếp ở panel.

Nếu không nhận diện đúng: mở DevTools trên Flow, dùng công cụ chọn phần tử để xác định editor/nút/ảnh, sao chép selector phù hợp rồi sửa `CONFIG`. Không dán selector chứa prompt, token hoặc URL ảnh tạm thời. Selector tùy chỉnh không được bỏ qua kiểm tra phần tử hiện/editable hoặc loại nút. Tải lại extension và tab, thử **một prompt** trước. Nếu editor chỉ hiện sau khi click, hãy click thủ công trước khi Bắt đầu.

Các giới hạn cần kiểm tra thực tế:

1. **Ảnh khác origin và CORS:** canvas chỉ xuất được ảnh mà Chrome cho phép đọc pixel. Nếu ảnh Google CDN bị CORS, bản này tự tải URL ảnh kết quả bằng Chrome Downloads và đợi Chrome xác nhận hoàn tất. Nếu URL không thuộc các họ miền Google được phép, hoặc tải HTTPS thất bại, hàng đợi dừng; dùng nút tải của Flow, không chạy lại prompt. Chrome Downloads có thể gửi cookie miền tệp như nêu trên. Nếu bạn đang tạo video mà thấy lỗi CORS PNG, hãy kiểm tra prompt đã gửi trên Flow và chọn **Video** cho các lượt mới.
2. **Ảnh mới không đồng nghĩa ảnh đúng prompt:** với Flow, tiện ích so URL ảnh với những ảnh có trước khi bấm tạo và chờ ổn định; với ChatGPT, chỉ xét ảnh trong assistant message mới nhất. Không có API tác vụ chính thức để chứng minh quan hệ ảnh/prompt. Preview thay đổi hoặc ảnh đến trễ từ lượt trước vẫn có thể gây nhầm. Để trang ổn định, chọn 1 ảnh/lượt và không thao tác song song. Nhiều kết quả ảnh trong một assistant message của ChatGPT hoặc nhiều ảnh mới trên Flow sẽ làm hàng đợi dừng thay vì chọn bừa.
3. Ảnh trên Flow cần là thẻ `img` đang hiển thị, tối thiểu 256 × 256 pixel; không hỗ trợ CSS background, canvas của trang, shadow DOM đóng hoặc iframe. Tệp PNG xuất tối đa 32 triệu pixel và chuỗi base64 tối đa 24 triệu ký tự (khoảng 18 MB).
4. Video cần có thẻ `video` đã nạp dữ liệu hoặc link tải MP4/WebM rõ ràng trong DOM. Khi Flow hiện 0–99% hoặc nguồn video tạm chưa đọc được, tiện ích tiếp tục chờ trong cùng lượt, **không gửi lại prompt**. Video ở URL media Google được tải trực tiếp bằng Chrome Downloads. Luồng phát MSE/HLS `blob:` không đọc được, URL ngoài Google hoặc link cần thao tác menu riêng có thể vẫn không tải tự động được. **Chưa kiểm thử chế độ Video trên tài khoản Flow thật**; các bài kiểm thử chỉ dùng DOM mô phỏng.
5. Chế độ ảnh/video/model/số kết quả phải được người dùng chọn trên Flow. Chọn đúng **Ảnh/Video** trong panel; panel không tự đổi chế độ Flow. Nếu chọn sai, có thể có tác vụ đã gửi rồi nên kiểm tra trên Flow trước khi chạy lại.
6. Khi máy ngủ hoặc Chrome trì hoãn timer, tốc độ xử lý/chờ có thể thay đổi. Service worker gửi heartbeat tới content script khi hàng đợi chạy; tab dịch vụ cần mở. Nếu Chrome kết thúc worker bất ngờ, tiến độ đã lưu có thể khôi phục nhưng mục dở không tự gửi lại.
7. Hết thời gian chờ, hạn mức tài khoản, CAPTCHA, yêu cầu đăng nhập hoặc lỗi Google cần xử lý thủ công trên Flow. Tiện ích không tự vượt các bước đó và không tự thử lại một prompt.
8. **ChatGPT:** chưa xác minh selector trên phiên bản web/tài khoản thật. Bản này nhận diện composer/nút gửi phổ biến, tìm tin nhắn user mới khớp prompt rồi xét ảnh phía sau nó. Nếu giao diện tùy chỉnh không có thuộc tính role hoặc đổi cách hiển thị nội dung tin nhắn, có dự phòng chỉ nhận URL ảnh mới trong `main` sau thao tác gửi; URL ảnh đã có trước khi gửi bị loại. Nếu không tìm được ảnh mới duy nhất, script chờ/timeout thay vì tải ảnh từ lịch sử. Nếu ChatGPT đổi giao diện, trả lời văn bản, dùng album nhiều ảnh trong một message hoặc yêu cầu xác nhận, lượt đó có thể dừng. Dùng một prompt để thử trước khi chạy danh sách dài.

## Cấu trúc và kiểm tra

```text
manifest.json       Quyền, service worker, side panel, phạm vi content script
background.js       Điều phối hàng đợi, heartbeat tab, tải tệp và lưu tiến độ
shared.js           Kiểm tra URL, prompt, tùy chọn và tên tệp
content.js          Nhập DOM, bấm tạo một lần, chờ và xuất ảnh/video
chatgpt.js          Gửi prompt ảnh ChatGPT, nhận ảnh mới trong câu trả lời
sidepanel.html      Giao diện tiếng Việt, script cục bộ
sidepanel.css       Giao diện gọn, co giãn theo chiều rộng panel
sidepanel.js        Cấu hình, theo dõi và dừng hàng đợi nền
tests/              Kiểm thử logic và trình duyệt với trang Flow mô phỏng
```

Kiểm tra JavaScript/JSON bằng Node.js (chỉ dành cho phát triển, không cần để cài extension):

```powershell
node --check background.js
node --check shared.js
node --check content.js
node --check chatgpt.js
node --check sidepanel.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --test tests/core.test.cjs
node tests/browser.test.cjs
node tests/extension.test.cjs
```

Kiểm thử trình duyệt cần Playwright có sẵn trong môi trường phát triển và Chrome. Có thể đặt `NODE_PATH` tới thư mục node_modules chứa Playwright và `CHROME_PATH` tới Chrome. Các phụ thuộc này **không được nạp bởi extension**. Trang Flow trong kiểm thử do fixture cục bộ mô phỏng, chặn mạng; không đăng nhập hay gửi yêu cầu tạo ảnh thật.

`extension.test.cjs` nạp manifest thật vào Chromium hỗ trợ cờ `--load-extension`; đặt `CHROMIUM_PATH` tới bản Chromium phù hợp nếu đường dẫn mặc định của môi trường kiểm thử không tồn tại. Bài kiểm thử dùng hồ sơ trình duyệt tạm riêng, không chạm hồ sơ Chrome cá nhân. Nó mở trang panel của extension trực tiếp để kiểm tra API, không tự mở panel trên Chrome cá nhân.

Kết quả rà soát khi bàn giao:

- Cú pháp toàn bộ JavaScript và JSON hợp lệ; bộ kiểm thử logic bao gồm phạm vi ChatGPT.
- Bộ kịch bản Chrome mô phỏng bao gồm ChatGPT, Flow, dừng khi nhập/chờ/nghỉ/tải, hết thời gian, CORS, tải URL media hợp lệ, từ chối URL ngoài dịch vụ, lỗi tải và hiển thị prompt có ký tự HTML an toàn.
- Kiểm thử logic xác nhận service worker gửi hai prompt liên tiếp, tải từng kết quả và hoàn thành queue state mà không cần kết nối panel. Trang đích và lượt tải đều được mô phỏng; chưa xác minh trực tiếp trên tài khoản Flow hoặc ChatGPT.
- Đã xem ảnh chụp panel ở chiều rộng 390 pixel. Content script chỉ đọc video cục bộ qua `blob:`, `data:video` hoặc HTTPS cùng origin với `credentials: omit` và không theo redirect. Đường tải dự phòng chỉ giao URL HTTPS thuộc các họ miền media Google cho Chrome Downloads; Chrome có thể gửi cookie miền tệp như đã công bố. Không dùng API cookie/token/mật khẩu/lịch sử hoặc ghi prompt vào log. URL tài liệu và miền giả trong bài kiểm thử không được extension sử dụng.

Khi nghiệm thu thực tế: thử một ảnh trên từng dịch vụ, dừng lúc nhập/chờ/nghỉ/tải, đóng tab/panel, hai panel đồng thời, lỗi hết thời gian, thư mục chứa `../` và prompt chứa ký tự HTML. Kiểm tra ảnh thực sự tải xong trước khi mục được đánh dấu hoàn thành. Các bài kiểm thử mô phỏng không thay thế lượt nghiệm thu trên Flow hoặc ChatGPT.

Tài liệu API đối chiếu: [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Chrome Downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads). Đây chỉ là liên kết tài liệu trong README; extension không truy cập các địa chỉ này.

## Gỡ cài đặt

Dừng phiên đang chạy, mở `chrome://extensions`, chọn **Xóa** trên thẻ tuhamho_flow. Nếu muốn xóa ảnh, tự xóa thư mục ảnh trong Downloads. Thao tác gỡ không xóa ảnh, lịch sử tải của Chrome hoặc dữ liệu tài khoản Flow/ChatGPT.
