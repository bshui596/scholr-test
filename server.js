/**
 * Scholr AI backend
 * ------------------
 * Express server that receives chat messages from the Scholr website,
 * sends them to Google's Gemini API, and returns the AI response.
 *
 * The Gemini API key is NEVER sent to the browser.
 * It only lives on this server, loaded from an environment variable.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Comma-separated list of origins allowed to call this API.
// Example:
// "https://yoursite.netlify.app,http://localhost:5500"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(o => o.trim());

app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
  })
);

app.use(express.json({ limit: '100kb' }));

// Simple health check.
app.get('/', (req, res) => {
  res.send('Scholr AI backend is running. POST chat messages to /api/chat.');
});

app.post('/api/chat', async (req, res) => {
  try {
    // Make sure the Gemini API key exists.
    if (!GEMINI_API_KEY) {
      console.error('Missing GEMINI_API_KEY environment variable.');
      return res.status(500).json({
        error: 'The server is not configured with an API key yet.',
      });
    }

    const { message, history } = req.body || {};

    // Validate message.
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        error: 'A "message" string is required.',
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error: 'Message is too long.',
      });
    }

    // Convert the website's conversation history into Gemini's format.
    const contents = [];

    if (Array.isArray(history)) {
      for (const turn of history.slice(-10)) {
        if (
          turn &&
          (turn.role === 'user' || turn.role === 'assistant') &&
          typeof turn.content === 'string' &&
          turn.content.length <= 4000
        ) {
          contents.push({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [
              {
                text: turn.content,
              },
            ],
          });
        }
      }
    }

    // Add the newest user message.
    contents.push({
      role: 'user',
      parts: [
        {
          text: message,
        },
      ],
    });

    // Gemini API endpoint.
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                'You are the friendly assistant embedded in Scholr, a student ' +
                'workspace app used by IB students. Help with homework questions, ' +
                'study tips, planning, and general schoolwork. Keep answers clear, ' +
                'encouraging, and reasonably concise unless the student asks for detail.',
            },
          ],
        },
        contents,
      }),
    });

    // Handle Gemini API errors.
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();

      console.error(
        'Gemini API error:',
        geminiRes.status,
        errText
      );

      return res.status(502).json({
        error:
          'The AI service returned an error. Please try again shortly.',
      });
    }

    const data = await geminiRes.json();

    // Extract Gemini's response text.
    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('\n')
      .trim();

    res.json({
      reply:
        reply ||
        "Sorry, I couldn't come up with a response to that.",
    });
  } catch (err) {
    console.error('Unexpected error in /api/chat:', err);

    res.status(500).json({
      error: 'Something went wrong on the server.',
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Scholr AI backend listening on http://localhost:${PORT}`
  );
});