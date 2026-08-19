/**
 * Scholr AI backend
 * Streaming Gemini responses through Server-Sent Events (SSE)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map(o => o.trim());

app.use(
  cors({
    origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
  })
);

app.use(express.json({ limit: '100kb' }));

// Health check
app.get('/', (req, res) => {
  res.send('Scholr AI backend is running. POST chat messages to /api/chat.');
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      console.error('Missing GEMINI_API_KEY.');
      return res.status(500).json({
        error: 'The server is not configured with an API key yet.',
      });
    }

    const { message, history } = req.body || {};

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

    // Convert conversation history to Gemini format
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

    contents.push({
      role: 'user',
      parts: [
        {
          text: message,
        },
      ],
    });

    // Streaming Gemini endpoint
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();

      console.error(
        'Gemini API error:',
        geminiRes.status,
        errText
      );

      return res.status(502).json({
        error: 'The AI service returned an error. Please try again shortly.',
      });
    }

    // Tell browser we're sending an SSE stream
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Flush headers immediately
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');

      // Keep incomplete line for next chunk
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || !trimmed.startsWith('data:')) {
          continue;
        }

        const jsonText = trimmed.slice(5).trim();

        if (!jsonText || jsonText === '[DONE]') {
          continue;
        }

        try {
          const chunk = JSON.parse(jsonText);

          const text =
            chunk?.candidates?.[0]?.content?.parts
              ?.map(part => part.text || '')
              .join('') || '';

          if (text) {
            res.write(
              `data: ${JSON.stringify({ text })}\n\n`
            );
          }
        } catch (parseError) {
          console.error('Failed to parse Gemini chunk:', parseError);
        }
      }
    }

    // Tell browser the stream is finished
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

  } catch (err) {
    console.error('Unexpected error in /api/chat:', err);

    // If headers haven't been sent, return normal JSON error
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Something went wrong on the server.',
      });
    }

    // Otherwise send an SSE error
    try {
      res.write(
        `data: ${JSON.stringify({
          error: 'Something went wrong on the server.',
        })}\n\n`
      );
      res.end();
    } catch (_) {}
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scholr AI backend listening on port ${PORT}`);
});
