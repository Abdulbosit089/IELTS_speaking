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
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

app.post("/analyze-speech", upload.single("audio"), async (req, res) => {
  try {
    const audioFilePath = req.file.path;

    // Step 1: Transcribe audio with Whisper
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(audioFilePath),
      model: "whisper-1"
    });

    const transcriptText = transcription.text;

    // Step 2: Ask GPT for Band 7, 8, 9 structured responses
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an IELTS speaking evaluator. Given a student's input, rewrite it into Band 7, Band 8, and Band 9 responses. Return ONLY valid JSON with keys band7, band8, band9."
        },
        {
          role: "user",
          content: transcriptText
        }
      ],
      response_format: { type: "json_object" } // forces JSON output
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    fs.unlinkSync(audioFilePath); // cleanup uploaded file
    console.log(aiResponse)
    res.json({
      transcript: transcriptText,
      band7: aiResponse.band7,
      band8: aiResponse.band8,
      band9: aiResponse.band9
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error analyzing speech" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
