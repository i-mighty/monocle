import "dotenv/config";
import express from "express";
import cors from "cors";
import identity from "./routes/identity";
import meter from "./routes/meter";
import payments from "./routes/payments";
import analytics from "./routes/analytics";

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

