const { BrowserWindow, screen } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function qa({
  win,
  isLocked,
  setLock,
  record,
  root,
  setDimensions,
}) {
  const results = [];
  let back;
  function check(name, pass, details) {
    results.push({ name, pass, details });
    record({ type: "interaction-qa", name, pass, details });
  }
  async function input(action, point, delta = { x: 0, y: 0 }) {
    const physical = screen.dipToScreenPoint(point);
    const end = screen.dipToScreenPoint({
      x: point.x + delta.x,
      y: point.y + delta.y,
    });
    await new Promise((resolve, reject) => {
      const p = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(root, "tools/qa-input.ps1"),
          "-X",
          String(physical.x),
          "-Y",
          String(physical.y),
          "-Action",
          action,
          "-Dx",
          String(end.x - physical.x),
          "-Dy",
          String(end.y - physical.y),
        ],
        { windowsHide: true },
      );
      p.on("error", reject);
      p.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error(`input exit ${code}`)),
      );
    });
    await wait(350);
  }
  async function center() {
    const r = await win.webContents.executeJavaScript(
      "(()=>{const r=document.querySelector('.line').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
    );
    const b = win.getBounds();
    return { x: Math.round(b.x + r.x), y: Math.round(b.y + r.y) };
  }
  try {
    setDimensions({ width: 1000, height: 350 });
    win.setBounds({ x: 30, y: 20, width: 1000, height: 350 });
    back = new BrowserWindow({
      x: 30,
      y: 20,
      width: 1000,
      height: 350,
      frame: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await back.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          '<html><body style="margin:0;background:#20252d;color:white;height:100vh">Interaction QA backdrop<script>window.clicks=0;addEventListener("click",()=>window.clicks++)</script></body></html>',
        ),
    );
    back.showInactive();
    win.moveTop();
    setLock(true);
    await wait(1200);
    const c = await center();
    await input("left", c);
    const clicks = await back.webContents.executeJavaScript("window.clicks");
    check("locked-click-through-to-background", clicks === 1, {
      clicks,
      point: c,
    });
    await input("middle", await center());
    check("global-middle-unlock", !isLocked(), { locked: isLocked() });
    const before = win.getBounds();
    await input("drag", await center(), { x: 60, y: 30 });
    const after = win.getBounds();
    check(
      "unlocked-real-pointer-drag",
      Math.abs(after.x - before.x - 60) <= 5 &&
        Math.abs(after.y - before.y - 30) <= 5 &&
        Math.abs(after.width - before.width) <= 2 &&
        Math.abs(after.height - before.height) <= 2,
      { before, after },
    );
    await input("middle", await center());
    check("global-middle-relock", isLocked(), { locked: isLocked() });
    await input("left", await center());
    const clicksAfter =
      await back.webContents.executeJavaScript("window.clicks");
    check("relocked-click-through", clicksAfter === clicks + 1, {
      clicksAfter,
    });
  } catch (e) {
    check("qa-execution", false, { error: e.message });
  } finally {
    back?.destroy();
    setLock(true);
    fs.writeFileSync(
      path.join(root, "logs/interaction-qa.json"),
      JSON.stringify(results, null, 2),
    );
  }
  return results;
};
