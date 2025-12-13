import "dotenv/config";
import express from "express";
import cors from "cors";
import identity from "./routes/identity.js";
import meter from "./routes/meter.js";
import payments from "./routes/payments.js";
import analytics from "./routes/analytics.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/", identity);
app.use("/meter", meter);
app.use("/pay", payments);
app.use("/dashboard", analytics);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API on :${port}`);
});

