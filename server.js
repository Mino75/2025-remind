// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const secretKey = "my-static-key";

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // serve files from the current folder

function encryptData(data) {
  const json = JSON.stringify(data);
  return Buffer.from(secretKey + json).toString('base64');
}

function decryptData(data) {
  const decoded = Buffer.from(data, 'base64').toString('utf8');
  if (decoded.startsWith(secretKey)) {
    return JSON.parse(decoded.slice(secretKey.length));
  }
  throw new Error("Invalid key");
}

app.post('/sync', (req, res) => {
  try {
    const { payload } = req.body;
    const reminders = decryptData(payload);
    console.log("Received reminders from client:", reminders);
    const responsePayload = encryptData(reminders);
    res.json({ payload: responsePayload });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(400).json({ error: "Sync failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
