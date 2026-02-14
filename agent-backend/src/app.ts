import "dotenv/config";
import express from "express";
import cors from "cors";
import identity from "./routes/identity";
import meter from "./routes/meter";
import payments from "./routes/payments";
import analytics from "./routes/analytics";
import agents from "./routes/agents";
import pricing from "./routes/pricing";
import x402 from "./routes/x402";
import messaging from "./routes/messaging";
import economics from "./routes/economics";
import reputation from "./routes/reputation";
import simulation from "./routes/simulation";
import webhooks from "./routes/webhooks";
import antiAbuse from "./routes/antiAbuse";
import budget from "./routes/budget";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/", identity);
app.use("/meter", meter);
app.use("/pay", payments);
app.use("/dashboard", analytics);
app.use("/agents", agents);
app.use("/pricing", pricing);
app.use("/x402", x402);
app.use("/messaging", messaging);
app.use("/economics", economics);
app.use("/reputation", reputation);
app.use("/simulation", simulation);
app.use("/webhooks", webhooks);
app.use("/anti-abuse", antiAbuse);
app.use("/budget", budget);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API on :${port}`);
});
