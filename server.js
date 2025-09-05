import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import multer from "multer";
import express from "express";
import formidable from "formidable";

const app = express();
const port = process.env.PORT || 5000;

// --- Config ---
app.use(cors());
app.use(express.json());
app.use(express.static(new URL("../public", import.meta.url).pathname)); // serve frontend

const API_KEY = process.env.GEMINI_API_KEY; // <-- from .env
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash-preview-05-20"; // audio-capable


const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024, // 15MB file size limit
    },
});

const systemInstruction = `
    You are an AI specialized in generating IELTS speaking responses. Based on user's speech provide a sample spoken response for the IELTS Speaking test at three distinct proficiency levels: Band 7, Band 8, and Band 9.

    For each band, generate a sample speech that reflects the following characteristics:

    - **Band 7:** The speech should be clear and well-organized, with a generally good command of vocabulary and grammar, but may include some hesitations or minor errors.
    - **Band 8:** The speech should be very fluent and detailed, with a wide range of vocabulary and complex grammatical structures.
    - **Band 9:** The speech should be flawless, natural, and effortless, demonstrating a full command of the language with no significant errors.

    Your response must be a JSON object with the keys "band7", "band8", and "band9". The value for each key should be the generated speech text for that specific band. Do not include any additional text, analysis, or introductory phrases.
`;

const systemInstruction2 = `
        You are a world-class IELTS examiner. Your task is to provide a detailed analysis of a user's spoken English performance for the IELTS Speaking test. 
        Your analysis must include: An assessment for Band 9, with a detailed explanation of the characteristics a perfect-score response would have, and a clear comparison to the user's performance.

        Do not use personal pronouns like "you" or "your" in the analysis. Maintain a formal, academic tone.
        Your response must be a JSON object with the keys "score", and "feedback". The value for each key should be the generated speech text for that specific band. Do not include any additional text, analysis, or introductory phrases.
    `;


// Helper: turn a file (from formidable) to base64 inlineData part
const fileToInlinePart = async (f) => {
  const fs = await import("node:fs/promises");
  const buf = await fs.readFile(f.filepath || f._writeStream?.path || f.path);
  return {
    inlineData: {
      mimeType: f.mimetype || "audio/webm",
      data: buf.toString("base64"),
    },
  };
};

// --- API ROUTES ---
app.get("/start-test", async (req, res) => {
  try {
    const systemPrompt = `
      You are an expert IELTS examiner. Create a complete set of IELTS Speaking questions in JSON with keys part1, part2, part3.
      - Part 1: 3–4 short questions on everyday topics
      - Part 2: ONE cue card (long turn 1–2 minutes)
      - Part 3: 3–4 deeper, abstract follow-ups connected to Part 2
      Each question object MUST include { "question": string, "part": 1|2|3 }.
      Do NOT ask the user to show or demonstrate anything.
    `;

    const payload = {
      contents: [{ parts: [{ text: "Generate a full set of IELTS Speaking test questions." }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            part1: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  question: { type: "STRING" },
                  part: { type: "INTEGER" },
                },
              },
            },
            part2: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  question: { type: "STRING" },
                  part: { type: "INTEGER" },
                },
              },
            },
            part3: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  question: { type: "STRING" },
                  part: { type: "INTEGER" },
                },
              },
            },
          },
        },
      },
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;

    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) throw new Error(`API error: ${apiResponse.status} ${apiResponse.statusText}`);

    const data = await apiResponse.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const questions = JSON.parse(jsonText);
    return res.json(questions);
  } catch (err) {
    console.error("/start-test error:", err);
    return res.status(500).json({ error: "Failed to generate test questions." });
  }
});

app.post("/analyze-ielts-audio", async (req, res) => {
  const form = formidable({ multiples: true });

  try {
    const [fields, files] = await form.parse(req);

    const parts = [];
    const indices = Object.keys(files)
      .filter((k) => k.startsWith("audio_part_"))
      .map((k) => Number(k.split("_")[2]))
      .sort((a, b) => a - b);

    for (const i of indices) {
      const qField = fields[`question_part_${i}`]?.[0];
      const qObj = qField ? JSON.parse(qField) : { question: `Question ${i + 1}` };
      parts.push({ text: `Question ${i + 1}: ${qObj.question}` });

      const file = files[`audio_part_${i}`]?.[0];
      if (file) parts.push(await fileToInlinePart(file));
    }

    const systemPrompt = `
      You are a world-class IELTS Speaking examiner. Analyze the user's performance using the uploaded audio clips.
      Provide a JSON object with:
      {
        "user_score": 1..9,
        "feedback": {
          "fluency_and_coherence": {"assessment": string, "band_9_characteristics": string},
          "lexical_resource": {"assessment": string, "band_9_characteristics": string},
          "grammatical_range_and_accuracy": {"assessment": string, "band_9_characteristics": string},
          "pronunciation": {"assessment": string, "band_9_characteristics": string},
          "overall_feedback": string
        }
      }
      Only return JSON — no prose outside the JSON.
    `;

    const payload = {
      contents: [{ parts }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { responseMimeType: "application/json" },
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`;
    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) throw new Error(`API error: ${apiResponse.status} ${apiResponse.statusText}`);

    const data = await apiResponse.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!jsonText) {
      return res.status(500).json({ error: "No analysis returned from model." });
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse failed:", jsonText);
      return res.status(500).json({ error: "Invalid JSON from model." });
    }

    return res.json(analysis);
  } catch (err) {
    console.error("/analyze-ielts-audio error:", err);
    return res.status(500).json({ error: "Failed to analyze audio." });
  }
});


app.post('/analyze-speech', upload.single('audio'), async (req, res) => {
    // Check if a file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    // Get the audio file buffer and its MIME type
    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Convert the audio buffer to a base64 string
    const audioBase64 = audioBuffer.toString('base64');

    // Construct the payload for the Gemini API call
    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: "You are an IELTS speaking evaluator. Given a student's input, rewrite it into Band 7, Band 8, and Band 9 responses. Return ONLY valid JSON with keys band7, band8, band9.",
                    },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: audioBase64,
                        },
                    },
                ],
            },
        ],
        systemInstruction: {
            parts: [{ text: systemInstruction }],
        },
    };

    let apiResponse;
    const maxRetries = 3;
    let retries = 0;

    // Implement a simple retry mechanism with exponential backoff
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

    while (retries < maxRetries) {
        try {
            apiResponse = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (apiResponse.ok) {
                break; // Exit the retry loop on success
            } else if (apiResponse.status === 429) {
                const delay = Math.pow(2, retries) * 1000;
                console.warn(`Rate limit exceeded. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                retries++;
            } else {
                throw new Error(`API returned non-OK status: ${apiResponse.status}`);
            }
        } catch (error) {
            console.error('API call failed:', error);
            retries++;
        }
    }

    // Handle failure after all retries
    if (!apiResponse || !apiResponse.ok) {
        return res.status(500).json({ error: 'Failed to get a response from the Gemini API after multiple retries.' });
    }

    try {
        const result = await apiResponse.json();
        const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis could be generated.";
        
        // Return the generated text to the client
        res.status(200).json({ analysis: generatedText });

    } catch (error) {
        console.error('Error parsing API response:', error);
        res.status(500).json({ error: 'Failed to parse API response.' });
    }
});


app.post('/checkband', upload.single('audio'), async (req, res) => {
    // Check if a file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    // Get the audio file buffer and its MIME type
    const audioBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Convert the audio buffer to a base64 string
    const audioBase64 = audioBuffer.toString('base64');

    // Define the system instructions for the LLM
    

    // Construct the payload for the Gemini API call
    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: "You are an IELTS speaking evaluator. Given a student's input, check it and tell what band score is and give feedbacks to improve. Return ONLY valid JSON with keys user_score, feedback.",
                    },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: audioBase64,
                        },
                    },
                ],
            },
        ],
        systemInstruction: {
            parts: [{ text: systemInstruction2 }],
        },
    };

    let apiResponse;
    const maxRetries = 3;
    let retries = 0;

    // Implement a simple retry mechanism with exponential backoff

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

    while (retries < maxRetries) {
        try {
            apiResponse = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (apiResponse.ok) {
                break; // Exit the retry loop on success
            } else if (apiResponse.status === 429) {
                const delay = Math.pow(2, retries) * 1000;
                console.warn(`Rate limit exceeded. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                retries++;
            } else {
                throw new Error(`API returned non-OK status: ${apiResponse.status}`);
            }
        } catch (error) {
            console.error('API call failed:', error);
            retries++;
        }
    }

    // Handle failure after all retries
    if (!apiResponse || !apiResponse.ok) {
        return res.status(500).json({ error: 'Failed to get a response from the Gemini API after multiple retries.' });
    }

    try {
        const result = await apiResponse.json();
        const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis could be generated.";
        
        // Return the generated text to the client
        res.status(200).json({ analysis: generatedText });

    } catch (error) {
        console.error('Error parsing API response:', error);
        res.status(500).json({ error: 'Failed to parse API response.' });
    }
});

app.listen(port, () => {
  console.log(`Server listening at https://ielts-speaking.onrender.com:${port}`);
});
