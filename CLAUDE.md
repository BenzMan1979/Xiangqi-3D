# 3D 象棋：楚河漢界·名將對弈

瀏覽器 3D 中國象棋（Vite + TypeScript + Three.js）。企劃與決策紀錄在 `docs/PROPOSAL.md`，進度與結構在 `README.md`。

## 指令

```bash
npm ci
npm test           # vitest：規則引擎與陣營資料
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

`.github/workflows/deploy.yml`：推送到 `main` 時跑測試、建置並部署 GitHub Pages
（https://benzman1979.github.io/Xiangqi-3D/）。Pages 來源要在 repo 設定選「GitHub Actions」。

## 來歷與下一步

專案原本在 `BenzMan1979/MyFiles` 的 `xiangqi-3d/` 資料夾開發，已連同提交歷史搬到此 repo。
目前完成 P0～P2（規則引擎、陣營與人物、吃子特效與音樂）。下一步 P3：AI 對戰（Pikafish，入門到大師級）。
