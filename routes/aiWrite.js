// POST /api/ai-write
// Takes the raw transcript + a chosen mode, and asks Claude to turn it into
// polished writing. This is where "AI নিজের বুদ্ধি দিয়ে summary বা নতুন কথা
// যোগ করে" happens — the model doesn't just clean up wording, it can
// genuinely summarize, restructure, or expand based on the instruction.

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODE_INSTRUCTIONS = {
  professional: 'এই কথ্য transcript-টিকে একটি পরিমার্জিত, formal ও professional লেখায় রূপান্তর করো। মূল ভাষা (বাংলা/ইংরেজি/মিশ্র) বজায় রাখো।',
  cleanup: 'এই transcript-এর ভুল, পুনরাবৃত্তি ও filler word ঠিক করে পরিষ্কার, স্বাভাবিক লেখায় রূপান্তর করো, মূল অর্থ পরিবর্তন না করে।',
  summary: 'এই transcript-টির একটি সংক্ষিপ্ত সারমর্ম লিখো, মূল পয়েন্টগুলো ধরে রেখে। প্রয়োজনে context বুঝে গুরুত্বপূর্ণ পয়েন্ট স্পষ্ট করে তুলে ধরো।',
  detailed: 'এই transcript-টিকে বিস্তারিত ও সুসংগঠিত লেখায় রূপান্তর করো — প্রয়োজনে প্রাসঙ্গিক ব্যাখ্যা যোগ করে content-টি আরও সম্পূর্ণ করো।',
  email: 'এই transcript-এর content দিয়ে একটি প্রফেশনাল ইমেইল লেখো, উপযুক্ত greeting ও closing সহ।',
  meeting: 'এই transcript-টিকে মিটিং নোট format-এ (আলোচ্য বিষয়, সিদ্ধান্ত, পরবর্তী পদক্ষেপ) সাজাও।',
  todo: 'এই transcript থেকে একটি স্পষ্ট, action-oriented To-Do list তৈরি করো।',
  social: 'এই transcript-এর content দিয়ে একটি সংক্ষিপ্ত, আকর্ষণীয় social media post লেখো।',
};

router.post('/ai-write', async (req, res) => {
  try {
    const { transcript, mode, customInstruction } = req.body;
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required.' });
    }

    const instruction = mode === 'custom' && customInstruction
      ? customInstruction
      : MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.cleanup;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `${instruction}\n\nTranscript:\n"""${transcript}"""\n\nশুধু চূড়ান্ত লেখাটি দাও, কোনো preamble ছাড়া।`,
        },
      ],
    });

    const text = message.content.map((b) => b.text || '').join('\n').trim();
    res.json({ result: text });
  } catch (err) {
    console.error('AI write error:', err);
    res.status(500).json({ error: 'AI writing failed.', detail: err.message });
  }
});

module.exports = router;
