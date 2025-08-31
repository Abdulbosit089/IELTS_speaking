import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";

const app = express();
const port = 5000;

app.use(express.json());

const upload = multer({ dest: "uploads/" });

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Root check
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

// 🎤 Endpoint 1: Analyze speech into Band 7/8/9 versions
app.post("/analyze-speech", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const audioFilePath = req.file.path;

    // Step 1: Transcribe audio
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
    });

    const transcriptText = transcription.text;

    // Step 2: Generate Band 7, 8, 9 rewrites
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an IELTS speaking evaluator. Given a student's input, rewrite it into Band 7, Band 8, and Band 9 responses. Return ONLY valid JSON with keys band7, band8, band9.",
        },
        {
          role: "user",
          content: transcriptText,
        },
      ],
      response_format: { type: "json_object" }, // force JSON output
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    fs.unlinkSync(audioFilePath); // cleanup

    res.json({
      transcript: transcriptText,
      band7: aiResponse.band7,
      band8: aiResponse.band8,
      band9: aiResponse.band9,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error analyzing speech" });
  }
});

// 🎤 Endpoint 2: Check actual band score
app.post("/checkband", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const audioFilePath = req.file.path;

    // Step 1: Transcribe audio
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1",
    });

    const transcriptText = transcription.text;

    // Step 2: Evaluate band score
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an IELTS speaking examiner. Evaluate the student's transcript and give a band score from 0 to 9 (decimals allowed, e.g., 6.5). Respond ONLY in valid JSON with this format: { \"band\": number, \"feedback\": string }",
        },
        {
          role: "user",
          content: transcriptText,
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    fs.unlinkSync(audioFilePath); // cleanup

    res.json({
      transcript: transcriptText,
      band: aiResponse.band,
      feedback: aiResponse.feedback,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error checking band score" });
  }
});

// ✅ Start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
