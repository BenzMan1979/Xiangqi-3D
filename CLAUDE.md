# 3D 象棋：楚河漢界·名將對弈

瀏覽器 3D 中國象棋（Vite + TypeScript + Three.js）。企劃與決策紀錄在 `docs/PROPOSAL.md`，進度與結構在 `README.md`。

## 指令

```bash
npm ci             # postinstall 會把 Fairy-Stockfish 與 coi-serviceworker 複製到 public/（已列入 .gitignore）
npm test           # vitest：規則引擎、AI、陣營資料與演出模板
npm run build      # tsc --noEmit + vite build → dist/
npm run dev
```

網址加 `?debug` 會在 `window` 上開出 `__load(fen)`、`__project(x,y)`、`__game()` 等測試掛鉤，供瀏覽器自動化使用。

## 慣例

- 回覆與文件用繁體中文；程式碼註解與 commit 訊息用英文。
- `src/core/` 是純邏輯、要有測試；畫面、特效、音效不放進去。
- `vite.config.ts` 的 `base: './'` 讓建置結果可放在任何子路徑，不要改成絕對路徑。
- 音樂與音效全部用 Web Audio 即時合成，不放音檔。
- 人物立繪目前是程式產生的佔位剪影，之後換正式美術。

## 部署

`.github/workflows/deploy.yml`：推送到 `main`（或目前的預設分支）時跑測試、建置並部署 GitHub Pages
（https://benzman1979.github.io/Xiangqi-3D/）。Pages 來源要在 repo 設定選「GitHub Actions」。

## 來歷與下一步

專案原本在 `BenzMan1979/MyFiles` 的 `xiangqi-3d/` 資料夾開發，已連同提交歷史搬到此 repo。
目前完成 P0～P5（規則引擎、陣營與人物、吃子特效與音樂、AI 四個難度、終局兩段絕招演出、連線對戰與聊天）。
下一步：P6 打磨、熱門人物專屬演出；有機會再把大師級換成 Pikafish 並加上 NNUE 權重。
大師級用 Fairy-Stockfish（`fairy-stockfish-nnue.wasm` npm 套件，GPL-3.0），因為這個開發環境取不到 Pikafish 的 WASM 與權重
（權重授權另限「非商業」）。它要 SharedArrayBuffer：`vite.config.ts` 的 COOP/COEP 標頭供開發與預覽，部署到 Pages 靠
`coi-serviceworker`（`index.html` 載入）。`src/ai/fairy.integration.test.ts` 用它當第二個裁判，驗證我們的走法規則。
網路被擋時 `npm ci` 仍可完成（postinstall 只複製檔案），但沒有引擎檔案時大師按鈕會停用。
終局演出：人物與模板的對應在 `src/data/ultimates.ts`（新增人物要補一筆，測試會檢查），畫面模板在 `src/fx/ultTemplates.ts`
（純函式、依進度 t 繪製）。網址加 `?debug` 可用 `__ult('guan-yu', 'finisher')` 單獨預覽；`?slow=3` 放慢演出。
`src/ai/` 同樣是純邏輯並有測試（含 perft 與規則引擎交叉比對）；改動走子或將軍判斷時兩邊都要跑測試。
連線對戰（`src/net/`）：PeerJS 點對點，房號 5 碼、peer id 為 `xq3d-房號`；預設用 PeerJS 公用信令服務。協定在 `protocol.ts`
（收到的每則訊息都先 `parseMsg` 驗證；聊天文字只用 textContent 顯示）；`link.ts` 的 `Link` 負責握手與緩衝，可用記憶體內的
`Transport` 測試。本機測試時網址加 `?peerserver=127.0.0.1:9000` 指到自己跑的 `peer` 伺服器（`npx peer --port 9000`）。
走子由雙方各自在本機規則引擎驗證，訊息帶步數 `n` 以偵測不同步；悔棋請求帶 `n`，期間對方走子則作廢。
玩家名稱與常用語只存在各自瀏覽器的 localStorage（`xq3d.setup`、`xq3d.quicklines`）；名稱與聊天文字在 `protocol.ts` 的 `cleanName`／`cleanChat`
清理後才顯示，一律用 textContent。`Link.startHeartbeat` 每 4 秒 ping，背景分頁會在 ping 裡標 `hidden`，對方就不因沉默判離線。
網址加 `?debug` 有 `__net()` 可看連線狀態。
