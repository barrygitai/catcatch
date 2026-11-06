# CatchCat 演示（私人可用版）

用相机识别真猫、丢罐头、收成猫卡、放进图鉴，并在地图上看过去的遇猫记录。  
这是按官方产品体验做的**本地演示**，不是商店上架版，也不连接官方后端。

## 怎么打开

不要用 `file://` 直接双击打开（相机会失败，模块/CDN 也可能被拦）。

在本目录起一个本地静态服务：

```bash
cd catchcat   # 解压后的目录
python3 -m http.server 8765
```

然后在手机或桌面浏览器打开：

```
http://127.0.0.1:8765/
```

桌面浏览会显示成居中的手机框；窄屏则全屏。

## 页面

| 入口 | 说明 |
|------|------|
| 图鉴 | 默认页。贴纸式猫卡网格，顶部罐头 / 金币 / XP |
| 爪印（中间） | 全屏扫描：拖罐头 → 绿色瞄准条 → 识别 → 发现页 → 猫卡 |
| 地图 | Leaflet + OSM；自己的遇猫针脚 + 示例社区针脚；有安全提示 |
| 档案 | 野外日志：收集数、等级、最稀有、今日 |

## 演示模式

扫描页底部有 **「用演示猫试一次」**：不需要真猫或相机权限。仍会走丢罐头 + 绿色瞄准条，命中后必定收成一张猫卡。

## 数据

全部存在浏览器 `localStorage`（键 `catchcat_demo_v2`）：

- `cats[]`、`resources { cans, coins, xp }`、`nextSerial`、`lastCanRechargeAt`
- 罐头初始 20，上限 24；约每 3 分钟回复 1 罐

## 限制

- 真机识别依赖 TensorFlow.js coco-ssd（CDN），首次需联网下载模型
- 相机需要 HTTPS 或 localhost，以及用户授权；手电筒仅在支持 `torch` 的设备上显示
- 定位只留在浏览器里，用来把地图和示例针脚放到你附近；拒绝定位时不会落到别的城市
- 无对战、无商店、无账号、无支付

## 文件

```
/workspace/catchcat/
  index.html
  css/styles.css
  js/data.js
  js/storage.js
  js/app.js
  assets/cat-food-can.png
  assets/demo-cat-1.jpg … demo-cat-3.jpg
  README.md
```
