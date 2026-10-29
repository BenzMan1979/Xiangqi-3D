# 3D 象棋：楚河漢界·名將對弈（暫定）

瀏覽器 3D 中國象棋：單機雙人／連線雙人／AI 對戰，雙方各選一個國家，棋子由該國歷史名人擔任，
將死對方時由出手的人物放出全畫面絕招，結算時再由勝方主帥收尾。

**線上試玩：https://benzman1979.github.io/Xiangqi-3D/** （每次推送後自動更新）

企劃與決策紀錄：[docs/PROPOSAL.md](docs/PROPOSAL.md)

## 目前進度：P4 完成

- **P0** 完整象棋規則引擎（蹩馬腿、塞象眼、炮架、將帥對臉、將死、困斃、長將判負、重複局面、六十回合限著）、3D 棋盤、單機雙人、悔棋、認輸、視角切換、中文棋譜
- **P1** 開局選國家（楚、漢、蜀、魏、吳、秦、唐、宋，可同國對戰）、88 位人物 + 8 種兵種的生平與絕招資料、
  棋子上的人物立牌（俯視時自動收起）、滑鼠停留（手機長按）顯示人物介紹卡
- **P2** 依棋種的吃子演出（車衝撞碎裂、馬躍起重踏、炮火球爆炸、兵斬成兩半、士象封印光柱、將帥威壓），
  命中瞬間慢動作與震動、將軍時畫面邊緣紅光與戰鼓、程式合成的五聲音階配樂與音效、設定面板（音量、特效強度：完整／精簡／關閉）

- **P3** AI 對戰：選單可切「單機雙人／AI 對戰」，選難度（入門、中級、高手）與執紅／執黑；自寫引擎
  （Alpha-Beta + 置換表 + 靜止搜尋，跑在 Web Worker，不卡畫面），電腦思考時顯示「思考中」，悔棋會一次退回你的回合。
  引擎用 perft 與規則引擎交叉驗證。
  **大師級**：整合 [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)（GPL-3.0，WebAssembly 多執行緒版，
  每步思考 2 秒，棋力明顯強過自寫的高手級）。它需要跨來源隔離（SharedArrayBuffer）：開發與預覽伺服器直接送標頭，
  GitHub Pages 這類不能送標頭的主機靠 `coi-serviceworker`（第一次進站會自動重新整理一次）。
  環境不支援或引擎檔案缺失時，大師按鈕自動停用；執行中引擎出錯則自動改用高手並提示。

- **P4** 終局兩段演出：將死時先由「走出將死那一步的棋子」放出自己的絕招（暗場、立繪滑入、書法招式名、
  全畫面演出、「將死」大字與震動），接著敗方將帥碎裂；之後勝方主帥登場凱旋，畫面留在結算視窗後方。
  88 位人物各指定 8 種模板之一（斬擊、衝鋒、箭雨、火攻、水攻、震波、召喚、法陣）與顏色，
  困斃／長將／認輸只演主帥凱旋，和棋直接結算。可點擊、Esc 或空白鍵跳過；設定的特效強度會縮短演出或整個關閉。

人物立繪目前是程式產生的佔位剪影，之後替換成正式美術即可。

下一步：Pikafish 與 NNUE 權重（目前大師級用 Fairy-Stockfish 內建評估，沒有 NNUE）；熱門人物（關羽、項羽、岳飛…）的專屬演出；P5 連線雙人。

## 開發

```bash
npm install
npm run dev        # 開發伺服器
npm test           # 規則引擎測試
npm run build      # 輸出到 dist/，可直接放 GitHub Pages
```

## 結構

```
src/core/    規則引擎（純邏輯、有測試）：fen / rules / game / notation
src/ai/      自寫搜尋引擎（engine）、難度（levels）、Worker 與主執行緒包裝（worker / player）、
             大師級的 UCI 轉接（uci / uciMove）
public/engine/  Fairy-Stockfish 的 worker 轉接（fsf-worker.js）；vendor/ 是 npm install 時從 node_modules 複製的第三方檔案
scripts/     copy-engine.mjs（postinstall：複製引擎與 coi-serviceworker 到 public/）
src/data/    陣營與人物資料（名字、生平、絕招）
src/render/  Three.js 場景、棋盤、棋子、立牌、佔位立繪、動畫
src/fx/      粒子、碎片、衝擊波與各棋種吃子演出；終局絕招（ultTemplates 模板畫面、cinematic 時間軸與介面）
src/audio/   Web Audio 合成的配樂與音效
src/ui/      HUD、選陣營畫面、人物介紹卡、設定
src/main.ts  遊戲控制器
```

## 授權

大師級使用 Fairy-Stockfish（GPL-3.0，原始碼與授權文字見 `public/engine/vendor/Copying.txt`、
<https://github.com/fairy-stockfish/Fairy-Stockfish>）與 coi-serviceworker（MIT）。專案公開時以 GPL-3.0 釋出。
