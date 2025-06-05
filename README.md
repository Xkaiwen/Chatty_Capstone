# Chatty
Chatty is designed to address the diverse challenges users may face when learning a new language. <br />
It offers three core features: general conversation practice, scenario-based roleplay, and pronunciation practice. <br />
According to two rounds of user research, these functions effectively support users in improving their speaking and reading skills, providing a well-rounded and engaging language learning experience. <br/>
This capstone project is an extension of the Chatty group project from CS239 in Winter 2025. <br>
A possible helpful tutorial to fully understand the functions of Chatty. <br/>
[![Everything Is AWESOME](https://img.youtube.com/vi/StTqXEQ2l-Y/0.jpg)](https://www.youtube.com/watch?v=StTqXEQ2l-Y "Everything Is AWESOME")

## 🛠️ Setup Instructions

### ✅ Step 1: Clone the Repository

```bash
git clone https://github.com/your-username/Chatty_Capstone.git
cd chatty/NewUI+Backend
```

---

### ✅ Step 2: Install Python Dependencies

```bash
pip install -r requirements.txt
pip install pymongo
```

---

### ✅ Step 3: Install Node.js Dependencies for Frontend

```bash
npm install
```

---

### ✅ Step 4: Start the Backend (FastAPI)

```bash
cd Backend
uvicorn app.main:app --reload
```

This starts the backend on `http://localhost:8000`.

---

### ✅ Step 5: Add the API Key for the frontend environment

Add .env file to the frontend folder, which should include

NEXT_PUBLIC_APIKEY: <br />
NEXT_PUBLIC_AUTHDOMAIN: <br />
NEXT_PUBLIC_PROJECTID: <br />
NEXT_PUBLIC_STORAGEBUCKET: <br />
NEXT_PUBLIC_MESSAGINGSENDERID: <br />
NEXT_PUBLIC_APPID: <br />
NEXT_PUBLIC_MEASUREMENTID: <br />
NEXT_PUBLIC_API_URL: <br />
OPENAI_API_KEY= <br />
MONGODB_URI= <br />

You can get the API key from <br />
https://firebase.google.com/docs/projects/api-keys <br />
https://www.mongodb.com/products/tools/mongodb-query-api <br />
https://openai.com/api/ <br />

---

### ✅ Step 6: Start the Frontend (Next.js)

In a new terminal:

```bash
cd NewUI
npm run dev
```

Frontend runs on `http://localhost:3000`.
