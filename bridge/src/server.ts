import { getBridgePort } from "./config.js";
import { createApp } from "./routes.js";

const app = createApp();

const port = getBridgePort();
app.listen(port, "127.0.0.1", () => {
  console.log(`review-guide-bridge listening on http://127.0.0.1:${port}`);
});
