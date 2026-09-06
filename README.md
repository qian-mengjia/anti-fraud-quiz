# 智识反诈团日活动 H5

这是一个适合团日活动现场使用的反诈知识闯关小游戏，包含三个页面：

- 学生答题页：`/`
- 管理员控制台：`/admin`
- 电脑实时监控页：`/monitor`

## 运行

```bash
npm install
npm start
```

默认访问地址是 `http://localhost:3000`。正式对外使用时，请设置 `PUBLIC_BASE_URL` 为你的公网域名，例如：

```powershell
$env:PUBLIC_BASE_URL='https://your-domain.example'
$env:PORT='3000'
npm start
```

## 管理员

默认管理员口令是 `2026`。也可以通过环境变量修改：

```bash
ADMIN_PIN=your-pin PORT=3000 npm start
```

管理员操作顺序：

1. 打开 `/admin`，输入口令。
2. 把页面二维码投到大屏，同学扫码加入。
3. 确认人员到齐后点击“开始游戏”。
4. 需要提前结束时点击“结束本局”。
5. 下一场活动点击“重置本局”。

每位同学会从题库中随机获得固定的 15 道题，每题 15 秒，答对得 1 分，超时自动进入下一题。
