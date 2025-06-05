import os
from utilsEdit import talk_agent  # Update this import if needed
from openai import OpenAI
from prompts import SOUND_RESPONSE_DIR, PROFILE_DIR

# Initialize OpenAI client
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

os.makedirs(PROFILE_DIR, exist_ok=True)
os.makedirs(SOUND_RESPONSE_DIR, exist_ok=True)

# user input to the website 
username = input("Enter your username: ").strip()
talk_agent(username, client)  # Pass client instead of llm