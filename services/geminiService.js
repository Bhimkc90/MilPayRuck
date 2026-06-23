const GEMINI_MODEL = "gemini-2.5-flash";

const callGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.log("Gemini API error:", data);
  
    if (data.error && data.error.code === 429) {
      return "AI Coach is connected, but the free Gemini API limit has been reached. Please try again later.";
    }
  
    return "AI Coach is temporarily unavailable. Please try again later.";
  }

  return data.candidates[0].content.parts[0].text;
};

const getFinancialAdvice = async ({
  income,
  totalExpenses,
  remainingCash,
  savingsRate,
}) => {
  const prompt = `
You are a military financial coach for a web application called MilPayRuck.

Analyze this user's monthly financial summary:
- Income: $${income}
- Expenses: $${totalExpenses}
- Remaining cash: $${remainingCash}
- Savings rate: ${savingsRate}%

Give 3 short, practical recommendations.
Keep the tone professional, simple, and helpful.
`;

  return await callGemini(prompt);
};

const askFinancialCoach = async (question) => {
  const prompt = `
You are an AI financial coach for MilPayRuck, a military pay and budgeting application.

Answer this user's financial question:
"${question}"

Rules:
- Keep the answer short and practical.
- Use simple language.
- If math is needed, show the calculation clearly.
- Do not give legal or tax advice.
- Focus on budgeting, saving, debt reduction, and financial readiness.
`;

  return await callGemini(prompt);
};

module.exports = {
  getFinancialAdvice,
  askFinancialCoach,
};