# Thiết kế memory Markdown theo session

Ngày: 2026-10-21  
Trạng thái: Người dùng đã phê duyệt spec trong hội thoại; implementation plan cần được review và phê duyệt riêng.

## 1. Mục tiêu và các quyết định đã thống nhất

Refactor memorize-mcp để agent giữ được diễn biến công việc trong từng session, đồng thời đọc nhanh kiến thức có ích cho các phiên sau. Người dùng muốn Markdown dễ đọc và chỉnh sửa, cho phép append nhiều lần trong cùng session khi cần, theo hướng tổ chức memory mà người dùng thích ở Codex. Thiết kế này không khẳng định sao chép cơ chế nội bộ của Codex.

Đã thống nhất qua hội thoại:

- `.memorize/MEMORY.md` chứa kiến thức tổng hợp; mỗi session có một file Markdown riêng.
- Agent chủ động lưu thông tin đáng nhớ, không cần chờ yêu cầu lưu ở mỗi lần.
- Lịch sử session được append; memory tổng hợp có thể được sửa và gộp.
- Giữ ba tên tool hiện tại và bổ sung `update_memorize`, `read_memorize`.
- Tìm kiếm bằng từ khóa, có nguồn tham chiếu và giới hạn lượng nội dung trả về.
- Bảo vệ ghi đồng thời, hỗ trợ tiếp tục session, chống append trùng khi retry.
- Chuyển dữ liệu cũ có backup, không tự xóa hoặc nén lịch sử.

Tiêu chí thành công: phiên mới hiểu được kiến thức dự án từ bản tổng hợp ngắn, có thể lần tới diễn biến nguồn, còn phiên đang chạy có thể lưu checkpoint liên tục mà không ghi đè lịch sử hoặc các cập nhật của phiên khác.

## 2. Cơ sở từ source hiện tại và các giải pháp tham khảo

Source hiện tại:

- `src/dirs.ts`: xác định workspace từ CLI argument hoặc `process.cwd()`, lưu dưới `.memorize`.
- `src/storage/session.ts`: một `MEMORY.md` chung, danh sách section cố định, giới hạn toàn file 64 KiB, append/replace, lock và atomic rename.
- `index.ts`: ba tool; active session ID chỉ được nhớ trong process. Save không truyền section không đưa session ID vào entry.
- `src/storage/session.test.ts`: mô tả shared workspace, replace snapshot, section filtering và chuyển từ `# Session Memory` sang `# Workspace Memory`.
- `README.md`: hướng dẫn agent gọi tool; chưa có cơ chế tự quan sát hội thoại.

Các đối chiếu được dùng để chọn hướng, không phải benchmark runtime:

- [Basic Memory](https://github.com/basicmachines-co/basic-memory): Markdown là dữ liệu gốc, có thao tác đọc/sửa/append note và index phục vụ tìm kiếm. Học cách giữ dữ liệu dễ đọc, không đưa SQLite hoặc semantic graph vào phạm vi này.
- [MCP Memory reference server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory): entity, observation và relation phù hợp dữ kiện có cấu trúc. Không chọn graph làm định dạng gốc cho diễn biến session.
- [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service): có capture, retrieval và consolidation. Áp dụng sự tách biệt giữa ghi diễn biến và tổng hợp kiến thức; chưa triển khai backend, embeddings hoặc dịch vụ tự tổng hợp.

## 3. Phạm vi

Bao gồm storage Markdown, vòng đời session, năm tool MCP, đọc có phân trang, keyword search, concurrency, migration, hướng dẫn agent và tài liệu sử dụng. Giữ cách xác định workspace hiện tại.

Không bao gồm database, embeddings, cloud sync, knowledge graph, UI, lịch tự tổng hợp, tự đọc transcript, tự cài hook, xóa/retention, tự sửa cấu hình host hoặc commit. Không sửa `AGENT.md` của người dùng để áp đặt chính sách lưu.

Đây là thay đổi contract có chủ đích. Dữ liệu cũ được bảo toàn; client phải cập nhật cách dùng tool. Việc chọn version phát hành thuộc implementation plan hoặc release sau này.

## 4. Bố cục dữ liệu và định dạng

```text
.memorize/
  MEMORY.md
  sessions/
    <session-id>.md
    legacy-<sha256>.md          # Chỉ xuất hiện nếu có migration
  backups/
    legacy-<sha256>.md          # Bản sao byte-for-byte của file cũ
```

Không có index hoặc registry JSON cần đồng bộ. File lock và temporary file là chi tiết ghi dữ liệu, được dọn sau thao tác thành công.

### 4.1. Memory tổng hợp

`MEMORY.md` bắt đầu bằng marker `<!-- memorize:memory version=1 -->` do server quản lý, tiếp theo là nội dung Markdown do agent tổng hợp. Marker giúp phân biệt schema mới với memory cũ, không dùng title đơn thuần để nhận dạng. Revision là SHA-256 của toàn bộ bytes trên đĩa; không cần file revision riêng.

Nội dung không bị ép vào danh sách heading cố định. Agent ưu tiên quy ước dự án, quyết định còn hiệu lực, lưu ý và bài học đã xác nhận. Việc đang làm, kế hoạch tạm thời và checkpoint nằm trong session, trừ khi một quyết định đã có hiệu lực lâu dài.

Mỗi mục kiến thức cần dẫn tới ít nhất một entry nguồn. Ví dụ nội dung:

```markdown
# Project Memory

## Lưu trữ

- Dùng Markdown trong workspace làm dữ liệu gốc.
  Nguồn: [Quyết định lưu trữ](sessions/<session-id>.md#entry-<entry-id>).
```

Agent chịu trách nhiệm liên hệ đúng từng phát biểu với nguồn và phân biệt bằng chứng với suy luận. Server kiểm tra nguồn được truyền có tồn tại, không đánh giá tính đúng đắn ngữ nghĩa. Nội dung chưa xác nhận phải được ghi rõ, không được biến thành kết luận đã kiểm chứng.

Mục tiêu bản tổng hợp khoảng 16 KiB; vượt ngưỡng này trả lời lưu kèm khuyến nghị gộp gọn. Đây là khuyến nghị, không tự cắt nội dung hay xóa nguồn.

### 4.2. Session

Session mới bắt đầu bằng marker `<!-- memorize:session version=1 -->`, có ID UUID do server tạo, thời điểm bắt đầu UTC ISO-8601 và goal tùy chọn. Metadata không thay đổi khi resume. Không lưu trạng thái active vào một file dùng chung giữa các process.

Mỗi entry có anchor ổn định `entry-<entry-id>`, metadata ID/thời điểm/tiêu đề và Markdown tự do. Entry được thêm vào cuối file theo thứ tự ghi thành công. Không tự chuyển nội dung sang các mục Context/Decisions/Current State.

Parser phải phân biệt metadata do server tạo với heading hoặc code fence trong nội dung người dùng. Không tách entry chỉ bằng regex `##`. Mỗi entry gồm anchor, title một dòng, comment metadata JSON một dòng chứa `entryId`, `timestamp`, `contentBytes`, rồi đến content và separator xuống dòng. `contentBytes` là số byte UTF-8 của content đã chuẩn hóa; parser đọc đúng số byte đó trước khi tìm entry tiếp theo. Nội dung có heading hoặc comment giống metadata vẫn được giữ trong payload, không trở thành entry mới. Thiếu bytes hoặc metadata không hợp lệ là lỗi format; không sửa file bằng cách đoán. Comment JSON phải escape các ký tự có thể kết thúc HTML comment để title tự do vẫn hiển thị đúng trong Markdown.

Session legacy có metadata migration và một entry bao toàn bộ nội dung cũ; không cố chia lại theo session ID cũ vì không phải mọi update cũ đều có ID. Backup giữ nguyên bytes; nội dung import giữ nguyên văn bản và thứ tự, không tổng hợp lại.

## 5. Trách nhiệm agent và luồng sử dụng

MCP không có toàn bộ hội thoại và không thể bảo đảm agent gọi tool. Hướng dẫn chủ động lưu được cung cấp qua server instructions, mô tả tool, kết quả `start_session`, và một đoạn hướng dẫn để người dùng áp dụng vào host nếu cần. Không tự sửa host configuration hoặc file chỉ dẫn của project.

Luồng chuẩn:

1. Đầu phiên, gọi `start_session`, đọc memory tổng hợp và đọc tiếp các trang nếu bị giới hạn.
2. Search/read session cũ khi nhiệm vụ cần chi tiết hoặc nguồn bằng chứng.
3. Append khi có quyết định, phát hiện, thay đổi yêu cầu, kết quả đáng nhớ, blocker hoặc checkpoint. Không lưu mọi lượt hội thoại và không lưu secrets.
4. Khi có kiến thức đủ ổn định, lưu entry nguồn trước, đọc revision hiện tại của bản tổng hợp rồi gọi `update_memorize`.
5. Khi kết thúc phần việc hoặc trước compaction nếu host báo được thời điểm đó, lưu trạng thái, việc chưa xong và bước tiếp theo. Không phụ thuộc hoàn toàn vào hook kết thúc phiên.

Đọc memory không biến kế hoạch cũ thành quyền thực thi hiện tại. Agent luôn phân biệt yêu cầu hiện tại, quyết định cũ và thông tin có thể đã lỗi thời.

Không cần tool đóng phiên trong phiên bản này. Resume dùng session ID đã lưu bền vững; nếu agent không biết ID sau restart, có thể tìm session bằng search. Không tự đoán phiên gần nhất là phiên cần tiếp tục.

## 6. Contract của năm tool

Các kết quả thành công có dữ liệu có cấu trúc cùng phần text dễ đọc, tránh in hai bản đầy đủ của cùng nội dung. Lỗi dùng `isError: true`, mã lỗi ổn định và hướng xử lý. Schema từ chối field không hỗ trợ để client cũ không bị đổi nghĩa âm thầm.

### 6.1. `start_session`

- Input: `goal?`, `sessionId?`.
- Không có ID: khởi tạo workspace nếu cần, migration nếu nhận dạng dữ liệu cũ an toàn, rồi tạo session mới.
- Có ID: chỉ tiếp tục session tồn tại đúng định dạng; không tồn tại trả lỗi, không tạo mới bằng ID tùy ý. Nếu truyền goal khác goal đã lưu, trả lỗi thay vì bỏ qua hoặc sửa metadata.
- Output: `sessionId`, đường dẫn session, `resumed`, trang đầu memory tổng hợp với revision/cursor và hướng dẫn lưu chủ động. Có thông tin migration khi vừa thực hiện hoặc cần agent tổng hợp legacy.
- Resume không append một entry rỗng và không sửa lịch sử.

### 6.2. `save_memorize`

- Input bắt buộc: `sessionId`, `entryId`, `title`, `content`.
- ID entry do caller tạo trước lần gọi đầu tiên, dùng lại khi retry; UUID hợp lệ. Title là chuỗi một dòng không rỗng; content là Markdown không rỗng.
- Luôn append vào session đã tồn tại; không có mode replace, section hoặc implicit active session.
- Cùng ID và cùng title/content đã được chuẩn hóa theo cùng quy tắc: trả entry đã lưu với `deduplicated: true`, không đổi timestamp hoặc file. Cùng ID nhưng payload khác: trả `ENTRY_CONFLICT`.
- ID entry được scope theo session. Entry nguồn được định danh bằng cặp session ID và entry ID.
- Output: session ID, entry ID, timestamp, đường dẫn, anchor và trạng thái deduplication.

### 6.3. `update_memorize`

- Input bắt buộc: `sessionId`, `expectedRevision`, `content`, `sources`.
- `content` là toàn bộ phần Markdown tổng hợp mới, không chứa marker hệ thống. `sources` là danh sách không rỗng các cặp `{ sessionId, entryId }` làm bằng chứng cho thay đổi lần này, không bắt buộc liệt kê lại mọi nguồn của kiến thức không đổi.
- Caller đã append kiến thức vào session trước khi tổng hợp. File Markdown mới phải chứa tham chiếu tới các nguồn được khai báo; các tham chiếu nội bộ theo cú pháp nguồn chuẩn đều phải trỏ tới entry tồn tại.
- Dưới lock, so revision hiện tại với `expectedRevision`. Khác nhau trả `REVISION_CONFLICT`, không ghi; agent đọc lại rồi gộp, không tự retry ghi đè.
- Chỉ thay memory tổng hợp; không chỉnh các file session. Server bảo toàn/tạo marker hệ thống và trả revision mới, thời điểm cùng khuyến nghị dung lượng nếu cần.
- Nếu mất response sau lần ghi thành công, retry revision cũ có thể conflict; agent đọc lại để xác định cập nhật đã tồn tại. Không hứa idempotency riêng cho thao tác này.

### 6.4. `read_memorize`

- Input: `sessionId?`, `cursor?`, `maxBytes?`. Thiếu session ID nghĩa là đọc memory tổng hợp.
- Mặc định trả tối đa 16 KiB nội dung UTF-8, cho phép từ 1 đến 64 KiB. Không cắt giữa ký tự UTF-8; báo lỗi nếu budget không chứa nổi ký tự tiếp theo.
- Cursor gắn với target, revision và byte offset; tool sinh cursor, caller không truyền filesystem path. File đổi giữa các trang trả `STALE_CURSOR`, yêu cầu đọc lại; không ghép hai revision vào cùng một kết quả.
- Output: relative path, revision, nội dung trang, `truncated`, `nextCursor` nếu còn, và session ID nếu đọc session.
- Không có memory trả trạng thái rỗng cùng hướng dẫn bắt đầu phiên; session cụ thể không tồn tại trả `SESSION_NOT_FOUND`. Read không tự migration hoặc tạo file.

### 6.5. `search_memorize`

- Input: `query?`, `scope?` (`all`, `memory`, `sessions`; mặc định `all`), `sessionId?`, `limit?` (mặc định 3, tối đa 20).
- Query rỗng hoặc thiếu: trả trang đầu memory tổng hợp theo contract đọc; filter search trong trường hợp này bị từ chối để tránh ngữ nghĩa mơ hồ. Muốn đọc một session dùng `read_memorize`.
- Query có nội dung: tách từ theo whitespace, so khớp không phân biệt hoa/thường, AND trong cùng một đoạn ứng viên. Không ghép từ xuất hiện ở hai entry khác nhau thành một match.
- Ứng viên là đoạn Markdown trong memory hoặc nội dung một entry session. Snippet lấy vùng quanh match, tối đa 2 KiB mỗi kết quả; báo `snippetTruncated` nếu phải rút ngắn. Việc tìm xét toàn ứng viên, không chỉ snippet.
- Ưu tiên kết quả từ memory tổng hợp, sau đó session theo timestamp entry giảm dần; cùng timestamp sắp theo ID ổn định. Không dùng thứ tự heading làm thời gian.
- Kết quả có snippet, relative path, session/entry ID nếu có, timestamp nguồn nếu có và reference để đọc tiếp. Không gán thời gian import legacy thành thời gian xảy ra của sự kiện cũ; ghi rõ thời gian import.
- Tổng snippet bị giới hạn 16 KiB; trả số kết quả, `truncated` và lý do nếu chưa thể hiển thị hết trong limit/budget. Không trả tổng số match chính xác nếu đã dừng sớm.
- Scope `memory` kết hợp session ID là input không hợp lệ. Scope `all` kèm session ID được hiểu là chỉ session đó. Không tìm backup, lock hoặc temporary file.
- Không có kết quả là thành công với danh sách rỗng. File không đọc được hoặc không nhận dạng được phải trả lỗi hoặc partial-result warning rõ ràng; không lặng lẽ bỏ qua rồi khẳng định không có memory.

## 7. Ghi đồng thời, giới hạn và lỗi

- Một lock workspace bảo vệ migration và mọi thao tác read-modify-write. Lock có ownership token; chỉ owner được release. Contention trả `MEMORY_BUSY` để caller retry; không busy-wait kéo dài.
- Không xóa lock chỉ vì đã qua 30 giây khi process giữ lock còn sống. Lock mồ côi chỉ được thu hồi khi xác định owner process không tồn tại; trường hợp không xác định được trả lỗi rõ ràng thay vì đoán.
- Ghi temporary file cùng thư mục rồi atomic rename. Đọc thấy bản trước hoặc sau thao tác ghi, không thấy file đang ghi dở. Đây không phải cam kết chống mọi trường hợp mất điện ở cấp filesystem.
- Bỏ giới hạn 64 KiB trên tổng workspace và tổng session. Mỗi payload ghi tối đa 64 KiB UTF-8 để giới hạn một request; đọc/search có budget riêng như trên. Không tự rút gọn dữ liệu để vượt giới hạn.
- Session ID được validate theo UUID do server cấp hoặc ID legacy do migration tạo; entry ID là UUID. Chỉ truy cập path do server dựng trong `.memorize`; từ chối path traversal và symlink dẫn ra ngoài memory root.
- Lỗi tối thiểu: `INVALID_ARGUMENT`, `PAYLOAD_TOO_LARGE`, `SESSION_NOT_FOUND`, `ENTRY_CONFLICT`, `REVISION_CONFLICT`, `STALE_CURSOR`, `MEMORY_BUSY`, `UNSUPPORTED_FORMAT`, `MIGRATION_CONFLICT`, `IO_ERROR`.
- Save thành công chỉ được báo sau khi ghi hoàn tất. Nếu kết quả ghi không chắc chắn vì response hoặc cleanup lỗi, hướng dẫn retry cùng entry ID hoặc đọc revision; không khẳng định chưa ghi.
- Không thêm dependency hoặc provider LLM chỉ để tổng hợp. Search không tải toàn bộ workspace vào một chuỗi; xử lý tuần tự từng file và giữ kết quả trong budget. Chấp nhận chi phí quét tuyến tính trong phạm vi local hiện tại.

## 8. Migration và tương thích

Migration chỉ chạy trong `start_session`, dưới lock; đọc/search không tự biến đổi dữ liệu. Hỗ trợ file legacy bắt đầu bằng title `# Session Memory` hoặc `# Workspace Memory`, và file rỗng/whitespace. File non-empty không nhận dạng được trả `UNSUPPORTED_FORMAT`, không ghi đè.

Quy trình:

1. Đọc bytes gốc và tính SHA-256. Đường dẫn backup và legacy session dùng hash này để retry không tạo bản sao mới.
2. Tạo backup byte-for-byte bằng thao tác không ghi đè; nếu đã có thì xác nhận bytes giống nhau. Khác nhau trả `MIGRATION_CONFLICT`.
3. Với nội dung non-empty, tạo legacy session và một entry nguồn có ID xác định ổn định từ hash. Giữ toàn bộ văn bản cũ trong entry. Nếu artifact đã có, xác nhận format/nguồn/nội dung đúng trước khi tiếp tục.
4. Tạo memory tổng hợp schema mới với liên kết tới entry legacy và nhắc agent cần đọc/tổng hợp; chưa coi nội dung legacy là kiến thức đã xác nhận. File rỗng/whitespace vẫn có backup nguyên trạng nhưng không tạo entry nguồn rỗng.
5. Chỉ thay `MEMORY.md` sau khi các artifact cần thiết đã ghi hoàn tất. Sau đó tạo hoặc resume session được yêu cầu và trả tình trạng migration.

Nếu gián đoạn trước bước thay memory, file cũ vẫn còn và lần gọi sau tiếp tục bằng hash/artifact cũ. Nếu gián đoạn sau đó, marker schema mới ngăn migration lặp lại. Không xóa backup hoặc legacy session.

Không ánh xạ `mode: replace` cũ sang một thao tác mới. Field `mode` hoặc `section` của client cũ trả lỗi có hướng dẫn: append qua `save_memorize`, sửa tổng hợp qua `update_memorize`. `save_memorize` thiếu session/entry ID trả lỗi cần cập nhật client. Không fallback sang process active ID.

## 9. Ranh giới thành phần và file dự kiến

Implementation plan sẽ chốt danh sách file và từng bước trước khi sửa code. Phân trách nhiệm dự kiến:

- `index.ts`: khai báo schema tool, server instructions, gọi storage và format response; không chứa parser hoặc logic migration. Với stdio, thông tin chẩn đoán phải đi stderr để không làm hỏng protocol.
- `src/dirs.ts`: giữ workspace resolution; không đổi host configuration.
- `src/storage/session.ts`: tạo/resume session và append entry có deduplication.
- Module storage riêng cho memory tổng hợp/revision, đọc/search, format Markdown và thao tác file/migration, tách theo trách nhiệm thực tế; tránh dồn toàn bộ chức năng mới vào một file.
- `src/storage/index.ts`: export API storage được tool dùng.
- Test storage/contract: thay các kỳ vọng fixed section, destructive replace và giới hạn toàn workspace bằng hành vi mới.
- `README.md`: contract mới, đoạn hướng dẫn lưu chủ động, ví dụ resume/append/consolidate/search, migration và giới hạn của tự động hóa.

Chưa thay version, changelog hoặc lockfile trong giai đoạn spec. Implementation plan chỉ đưa những file đó vào khi có lý do cụ thể.

## 10. Tiêu chí nghiệm thu và chiến lược kiểm chứng

Các tiêu chí để người dùng kiểm chứng sau implementation:

1. Tạo hai session không mất dữ liệu; append nhiều entry vào đúng session, resume sau restart không tạo session trùng.
2. Retry cùng entry ID/payload không thêm bản trùng; payload khác trả conflict.
3. Markdown tự do, heading và code fence trong nội dung không làm sai ranh giới entry hoặc nguồn tham chiếu.
4. Hai phiên append không mất update; cập nhật summary bằng revision cũ bị từ chối và giữ nội dung hiện tại.
5. Knowledge tổng hợp dẫn được về entry; nguồn không tồn tại bị từ chối; summary warning không tự cắt dữ liệu.
6. File session/workspace vượt 64 KiB vẫn lưu được qua nhiều entry; đọc phân trang đúng UTF-8 và cursor cũ báo lỗi rõ.
7. Search AND trong đúng ứng viên, ưu tiên summary, sắp timestamp session đúng, snippet có nguồn và tuân thủ budget; không đọc backup như memory hiện hành.
8. Migration cả hai title cũ, file rỗng/whitespace, retry và gián đoạn không mất dữ liệu hoặc tạo legacy trùng; custom format không bị ghi đè.
9. Lock mồ côi/đang sống, lỗi I/O, ID không hợp lệ và symlink ra ngoài root có kết quả rõ ràng.
10. Client cũ dùng replace/section nhận hướng dẫn chuyển đổi; tool mới và README nhất quán.
11. Instructions có hướng dẫn capture và consolidate; tài liệu không hứa MCP tự đọc hội thoại hoặc bảo đảm hook cuối phiên.

Không chạy build, test, lint, typecheck hoặc lệnh verify trong giai đoạn này. Implementation plan sẽ liệt kê command phù hợp để người dùng tự chạy, cùng các tình huống kiểm tra qua MCP client. Việc đọc source/test hiện có là cơ sở thiết kế, không phải bằng chứng runtime.

## 11. Gate tiếp theo

Người dùng review và phê duyệt spec này trước. Sau đó mới chuyển sang viết implementation plan theo brainstorming workflow. Implementation cần plan theo file được người dùng duyệt và lựa chọn cách thực thi. Không commit nếu chưa được yêu cầu rõ ràng.
