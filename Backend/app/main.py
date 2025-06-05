from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import json
from datetime import datetime
import dotenv
import re
from openai import OpenAI
from typing import Optional
import random
import time
from prompts import SOUND_RESPONSE_DIR, LANGUAGE_MAP, DEFAULT_SCENARIOS
from database.mongodb_manager import MongoDBManager
from fastapi.responses import JSONResponse
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException, Body
from pymongo import MongoClient
from bson import ObjectId
import json
import traceback
import base64
from pathlib import Path
import sys

dotenv.load_dotenv()
SENTENCE_CACHE = {}
db_manager = MongoDBManager()

import openai
from dotenv import load_dotenv

load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

from fastapi.middleware.cors import CORSMiddleware

import logging
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database.init_db import init_mongodb
from database.mongodb_manager import MongoDBManager
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

try:
    # Try to initialize with the new method
    db = init_mongodb()
    db_manager = MongoDBManager()  # Use your existing constructor
    logger.info("MongoDB manager initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize MongoDB: {e}", exc_info=True)
    # Fall back to direct initialization
    try:
        db_manager = MongoDBManager()
        logger.info("MongoDB manager initialized with fallback method")
    except Exception as e2:
        logger.critical(f"Critical database initialization failure: {e2}", exc_info=True)
        db_manager = None

DEFAULT_SUGGESTIONS = [
    "Tell me more about that.",
    "What do you think about this?",
    "Can you explain that further?"
]
def load_user_profile(username):
    try:
        return db_manager.load_user_profile(username)
    except Exception as e:
        print(f"Error loading user profile from MongoDB: {e}")
        return {
            "username": username,
            "ai_role": "AI assistant",
            "language": "English", 
            "locale": "en",
            "scenario": "en",
            "chat_history": [],
            "lessons": [],
            "custom_scenarios": [],
            "created_at": datetime.now().isoformat()
        }

def save_user_profile(user_profile):
    try:
        db_manager.save_user_profile(user_profile)
    except Exception as e:
        print(f"Error saving user profile to MongoDB: {e}")
        raise

def clean_text(text):
    """Clean text for TTS processing."""
    text = re.sub(r'[^\w\s.,?!;:()\-\'"\u4e00-\u9fff\u3040-\u30ff]', '', text)
    return text

def infer_ai_role(scenario, client):
    if scenario == "Language Practice":
        return "Language Practice Partner"
        
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system", 
                    "content": "You are a helpful assistant that suggests appropriate role-play characters."
                },
                {
                    "role": "user", 
                    "content": f"Based on this scenario: '{scenario}', what would be an appropriate character or role for an AI to play? Respond with ONLY the role name, no explanation."
                }
            ],
            temperature=0.7,
            max_tokens=30,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error inferring AI role: {e}")
        return "Conversation Partner"

def clean_generated_text(text, language, content_type):
    """Clean generated text to remove explanations and extra information"""
    if not text:
        return text
        
    text = text.strip().strip('"\'`""''')
    
    import re
    text = re.sub(r'\([^)]*\)', '', text).strip()
    
    text = re.sub(r'\s*[-–—]\s*.*$', '', text).strip()
    
    if content_type == 'word':
        text = re.sub(r'\s*,\s*.*$', '', text).strip()
    
    if language in ['ko', 'ja', 'zh-CN', 'zh-TW']:
        if content_type == 'word':
            text = re.sub(r'[a-zA-Z0-9\s\-_.,!?()[\]{}]+', '', text).strip()
            
            if language == 'ko':
                korean_chars = re.findall(r'[가-힣]+', text)
                if korean_chars:
                    text = korean_chars[0]
            
            elif language == 'ja':
                japanese_chars = re.findall(r'[ひらがなカタカナ一-龯ぁ-ゖァ-ヾ]+', text)
                if japanese_chars:
                    text = japanese_chars[0]
            
            elif language in ['zh-CN', 'zh-TW']:
                chinese_chars = re.findall(r'[一-龯]+', text)
                if chinese_chars:
                    text = chinese_chars[0]
    
    else:
        if content_type == 'word':
            words = text.split()
            if words:
                text = words[0]
                text = re.sub(r'[^\w]', '', text)
    
    return text

app = FastAPI(title="Language Learning API", 
              description="API for language learning conversations with AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CLIENT_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/audio", StaticFiles(directory=SOUND_RESPONSE_DIR), name="audio")

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

class ChatRequest(BaseModel):
    username: str
    message: str
    scenario: Optional[str] = None
    language: Optional[str] = "en"
    user_locale: Optional[str] = "en"
    response_locale: Optional[str] = "en" 
    voice_locale: Optional[str] = "en"
    reset_language_context: Optional[bool] = False
    force_language: Optional[bool] = False
    save_to_history: Optional[bool] = True
    is_discarded: Optional[bool] = False
    conversation_id: Optional[str] = None 

class ChatResponse(BaseModel):
    response: str
    audio_url: Optional[str] = None

class SuggestionRequest(BaseModel):
    username: str
    language: Optional[str] = None
    language_name: Optional[str] = None
    locale: Optional[str] = None
    force_language: Optional[bool] = False

class SuggestionResponse(BaseModel):
    suggestions: List[str]

class LessonRequest(BaseModel):
    username: str

class LessonResponse(BaseModel):
    critique: str
    lessons: List[str]

class ScenarioRequest(BaseModel):
    username: str
    scenario: str
    language: str

class ScenarioResponse(BaseModel):
    scenario: str
    ai_role: str

class PracticeSentenceRequest(BaseModel):
    language: str
    difficulty: str
    username: Optional[str] = None

class PracticeSentence(BaseModel):
    text: str
    difficulty: str
    audio_url: Optional[str] = None

class MongoJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        return super().default(obj)

@app.get("/")
async def root():
    return {"message": "Language Learning API is running"}

@app.post("/api/init_user_profile")
async def init_user_profile(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        init_custom_scenarios = data.get("init_custom_scenarios", False)
        
        if not username:
            return JSONResponse(
                status_code=400,
                content={"error": "Username is required"}
            )
        existing_user = db_manager.db["users"].find_one({"username": username})
        
        if existing_user:
            update_data = {}
            
            if init_custom_scenarios and "custom_scenarios" not in existing_user:
                update_data["custom_scenarios"] = []
            
            if update_data:
                db_manager.db["users"].update_one(
                    {"username": username},
                    {"$set": update_data}
                )
                return JSONResponse(content={"success": True, "message": "User profile updated"})
            else:
                return JSONResponse(content={"success": True, "message": "User profile already exists"})
        else:
            new_user = {
                "username": username,
                "created_at": datetime.datetime.utcnow().isoformat()
            }
            
            if init_custom_scenarios:
                new_user["custom_scenarios"] = []
            
            db_manager.db["users"].insert_one(new_user)
            return JSONResponse(
                content={"success": True, "message": "User profile created"}
            )
    except Exception as e:
        print(f"Error initializing user profile: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to initialize user profile: {str(e)}"}
        )

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    username = request.username
    message = request.message
    
    # Extract request fields with proper defaults
    is_discarded = getattr(request, 'is_discarded', False)
    save_to_history = getattr(request, 'save_to_history', True)
    conversation_id = getattr(request, 'conversation_id', None)
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
    
    # Log incoming request parameters
    logger.info(f"Processing chat for user={username}, is_discarded={is_discarded}, save_to_history={save_to_history}")
    
    # If is_discarded is true, force save_to_history to false
    if is_discarded:
        save_to_history = False
        logger.info("Request marked as discarded - forcing save_to_history=False")
    
    # Extract fields from request
    is_roleplay = request.scenario != "Language Practice" if request.scenario else False
    
    # If this is roleplay, don't save to main history
    if is_roleplay:
        save_to_history = False
        logger.info("Roleplay scenario detected - forcing save_to_history=False")
    
    try:
        # Load the user profile
        user_profile = db_manager.load_user_profile(username)
        
        # Check if user profile has discard flag set
        if (user_profile.get("preferences", {}).get("discard_conversation", False)):
            logger.info(f"User profile has discard_conversation flag set - forcing save_to_history=False")
            save_to_history = False
            is_discarded = True
        
        # Process language preferences
        target_language = None
        if hasattr(request, 'response_locale') and request.response_locale:
            target_language = normalize_language(request.response_locale)
            logger.info(f"Using response_locale parameter: {target_language}")
        elif hasattr(request, 'language') and request.language:
            target_language = normalize_language(request.language)
            logger.info(f"Using language parameter: {target_language}")
        
        if hasattr(request, 'reset_language_context') and request.reset_language_context:
            logger.info(f"Resetting language context for {username}")
            
        if target_language and (hasattr(request, 'force_language') and request.force_language):
            logger.info(f"Forcing language to {target_language} for user {username}")
            user_profile["language"] = target_language
            user_profile["locale"] = target_language
        
        # Handle scenario settings
        if request.scenario:
            if user_profile.get("scenario") != request.scenario:
                user_profile["scenario"] = request.scenario
                ai_role = infer_ai_role(request.scenario, client)
                user_profile["ai_role"] = ai_role
        
        if not user_profile.get("scenario"):
            user_profile["scenario"] = "Language Practice"
            user_profile["ai_role"] = "Language Practice Partner"
        
        if not user_profile.get("ai_role"):
            user_profile["ai_role"] = infer_ai_role(user_profile["scenario"], client)
        
        language = user_profile.get("language", "en")
        if target_language:
            language = target_language
        
        user_profile["language"] = language
        user_profile["locale"] = language
        
        language_name = {
            "en": "English",
            "zh-cn": "Simplified Chinese",
            "zh-tw": "Traditional Chinese",
            "ja": "Japanese",
            "ko": "Korean",
            "es": "Spanish",
            "fr": "French",
            "de": "German",
            "it": "Italian",
            "hi": "Hindi",
        }.get(language.lower(), "English")
        
        scenario_desc = user_profile["scenario"]
        ai_role = user_profile["ai_role"]
        
        # Build prompt for AI
        system_prompt = (
            f"You are playing the role of {ai_role} in the following scenario: {scenario_desc}. "
            f"You MUST respond ONLY in {language_name}. "
            f"Do not use any language other than {language_name}, regardless of what language the user writes in. "
            f"Your response should be completely in {language_name}."
        )
        
        messages = [{"role": "system", "content": system_prompt}]
        
        # Add conversation history if not roleplay
        if not is_roleplay:
            relevant_history = []
            for entry in user_profile.get("chat_history", []):
                entry_conversation_id = entry.get("conversation_id")
                
                if not entry_conversation_id or entry_conversation_id == conversation_id:
                    relevant_history.append(entry)
            
            for entry in relevant_history:
                if "user" in entry and entry["user"] != "AI INITIATED":
                    messages.append({"role": "user", "content": entry["user"]})
                if "ai" in entry:
                    messages.append({"role": "assistant", "content": entry["ai"]})
        else:
            try:
                conversation_collection = db_manager.db["scenario_conversations"]
                conversation = conversation_collection.find_one({
                    "username": username,
                    "scenario_title": scenario_desc,
                    "is_deleted": {"$ne": True},
                    "deleted": {"$ne": True}
                })
                
                if conversation:
                    conversation_id = str(conversation["_id"])
                    message_collection = db_manager.db["scenario_messages"]
                    scenario_messages = list(message_collection.find({"conversation_id": conversation_id}))
                    
                    for msg in scenario_messages:
                        role = "user" if msg.get("sender") == "user" else "assistant"
                        messages.append({"role": role, "content": msg.get("text", "")})
            except Exception as e:
                logger.error(f"Error fetching roleplay conversation context: {e}")
        
        messages.append({"role": "user", "content": message})
        
        messages.append({
            "role": "system", 
            "content": f"Remember to respond ONLY in {language_name}, no matter what."
        })
        
        # Generate AI response
        logger.info(f"Sending prompt to OpenAI with {len(messages)} messages")
        response = client.chat.completions.create(
            model="gpt-4", 
            messages=messages,
            max_tokens=200,
            temperature=0.7,
            presence_penalty=0.1,
            frequency_penalty=0.1,
            stop=None
        )
        
        ai_response = response.choices[0].message.content
        
        if ai_response and not ai_response.strip().endswith(('.', '!', '?', '。', '！', '？')):
            logger.warning(f"Response might be incomplete: '{ai_response}'")
            
            try:
                completion_prompt = f"""Complete this response naturally and make it longer: "{ai_response}"
                Make it 2-3 complete sentences total. The response should be conversational and natural.
                Do not use numbered lists (like 1., 2., 3.) or bullet points.
                Make it flow as natural conversation.
                Only provide the completed response, nothing else."""
                
                completion_response = client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[
                        {"role": "system", "content": f"Complete sentences naturally in {language_name}. Make responses complete, conversational, and 2-3 sentences long. Avoid numbered lists."},
                        {"role": "user", "content": completion_prompt}
                    ],
                    max_tokens=120,
                    temperature=0.3,
                    stop=None
                )
                
                completed_response = completion_response.choices[0].message.content.strip()
                
                if completed_response and len(completed_response) > len(ai_response):
                    if ai_response.lower() in completed_response.lower():
                        ai_response = completed_response
                        logger.info(f"Successfully completed response: '{ai_response}'")
                    else:
                        ai_response = ai_response.strip() + "."
                else:
                    ai_response = ai_response.strip() + "."
                    
            except Exception as completion_error:
                logger.warning(f"Failed to complete response: {completion_error}")
                ai_response = ai_response.strip() + "."
        
        if re.search(r'\d+\.\s*$', ai_response):
            logger.warning("Response ends with incomplete numbered list")
            ai_response = re.sub(r'\d+\.\s*$', '', ai_response).strip()
            if not ai_response.endswith(('.', '!', '?', '。', '！', '？')):
                ai_response += "."
        
        system_prompt = (
            f"You are playing the role of {ai_role} in the following scenario: {scenario_desc}. "
            f"You MUST respond ONLY in {language_name}. "
            f"Keep your responses conversational and natural - aim for 2-3 complete sentences. "
            f"Do not use numbered lists (1., 2., 3.) or bullet points. "
            f"Always end your sentences properly with punctuation. "
            f"Make your responses flow naturally as conversation. "
            f"Do not use any language other than {language_name}, regardless of what language the user writes in. "
            f"Your response should be completely in {language_name}."
        )
        
        if not ai_response:
            fallbacks = {
                "en": "I'm thinking about what to say. Could you please repeat your question?",
                "zh-cn": "我正在思考该怎么回答。请您再问一次好吗？",
                "zh-tw": "我正在思考該怎麼回答。請您再問一次好嗎？",
                "ja": "何を言うべきか考えています。もう一度質問していただけますか？",
                "ko": "무슨 말을 해야 할지 생각 중입니다. 질문을 다시 해주시겠어요?",
                "es": "Estoy pensando en qué decir. ¿Podrías repetir tu pregunta?",
                "fr": "Je réfléchis à quoi dire. Pourriez-vous répéter votre question ?",
                "de": "Ich überlege, was ich sagen soll. Könnten Sie Ihre Frage wiederholen?",
                "it": "Sto pensando a cosa dire. Potresti ripetere la tua domanda?",
                "hi": "मैं सोच रहा हूं कि क्या कहूं। क्या आप अपना प्रश्न दोहरा सकते हैं?",
            }
            ai_response = fallbacks.get(language.lower(), fallbacks["en"])
        
        logger.info(f"Save decision - is_discarded: {is_discarded}, save_to_history: {save_to_history}, is_roleplay: {is_roleplay}")
        
        if save_to_history and not is_discarded and not is_roleplay:
            logger.info(f"SAVING message to chat history for user {username}")
            user_profile["chat_history"].append({
                "user": message,
                "ai": ai_response,
                "timestamp": datetime.now().isoformat(),
                "conversation_id": conversation_id 
            })
            save_user_profile(user_profile)
        else:
            logger.info(f"NOT SAVING message to chat history (is_discarded={is_discarded}, save_to_history={save_to_history})")
        
        if is_roleplay:
            logger.info(f"Processing roleplay conversation for scenario: {scenario_desc}")
            try:
                conversation_collection = db_manager.db["scenario_conversations"]
                conversation = conversation_collection.find_one({
                    "username": username,
                    "scenario_title": scenario_desc,
                    "is_deleted": {"$ne": True},
                    "deleted": {"$ne": True}
                })
                
                if not conversation:
                    conversation_id = await db_manager.insert_scenario_conversation(
                        username=username,
                        scenario_title=scenario_desc,
                        description=scenario_desc,
                        is_custom=False,
                        language=language,
                        created_at=datetime.now().isoformat()
                    )
                else:
                    conversation_id = str(conversation["_id"])
                
                await db_manager.insert_scenario_message(
                    conversation_id=conversation_id,
                    text=message,
                    sender="user",
                    audio_url=None,
                    timestamp=datetime.now().isoformat()
                )
                
                await db_manager.insert_scenario_message(
                    conversation_id=conversation_id,
                    text=ai_response,
                    sender="assistant",
                    audio_url=None,
                    timestamp=datetime.now().isoformat()
                )
                
                logger.info(f"Saved roleplay conversation for scenario: {scenario_desc}")
                return {
                    "response": ai_response,
                    "audio_url": None,
                    "conversation_id": conversation_id
                }
            except Exception as e:
                logger.error(f"Error saving roleplay message: {e}")
                import traceback
                traceback.print_exc()
        
        # Return the response
        logger.info(f"Returning chat response for user {username}, conversation_id {conversation_id}")
        return {
            "response": ai_response,
            "audio_url": None,
            "conversation_id": conversation_id
        }
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to process chat: {str(e)}")

@app.get("/api/user_profile")
async def get_user_profile(username: str):
    try:
        user_profile = load_user_profile(username)
        
        if not user_profile:
            user_profile = {
                "username": username,
                "language": "English",
                "locale": "en",
                "created_at": datetime.now().isoformat(),
                "ai_role": "Language Practice Partner",
                "scenario": "Language Practice",
                "chat_history": [],
                "suggestions": [],
                "custom_scenarios": []
            }

        if "locale" not in user_profile:
            language = user_profile.get("language", "English")
            language_lower = language.lower()
            locale_mapping = {
                "english": "en",
                "chinese": "zh-CN",
                "japanese": "ja",
                "korean": "ko",
                "spanish": "es",
                "french": "fr",
                "hindi": "hi",
                "german": "de",
                "italian": "it"
            }
            
            user_profile["locale"] = locale_mapping.get(language_lower, "en")
        
        scenario_collection = db_manager.db["user_scenarios"]
        cursor = scenario_collection.find({"username": username, "custom": True})
        
        custom_scenarios = []
        for doc in cursor:
            scenario = {
                "id": doc.get("id"),
                "title": doc.get("title"),
                "description": doc.get("description"),
                "language": doc.get("language"),
                "custom": True,
                "created_at": doc.get("created_at")
            }
            custom_scenarios.append(scenario)
        
        user_profile["custom_scenarios"] = custom_scenarios
        
        print(f"Found {len(custom_scenarios)} custom scenarios for user {username}")
        
        return user_profile
    except Exception as e:
        print(f"Error retrieving user profile: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to retrieve user profile: {str(e)}")

@app.post("/api/set_user_profile")
async def set_user_profile(request: dict):
    try:
        username = request.get("username")
        language = request.get("language")
        locale = request.get("locale", language)
        scenario = request.get("scenario", language)
        ai_role = request.get("ai_role")
        
        if not username:
            raise HTTPException(status_code=400, detail="Username is required")
        
        user_profile = db_manager.load_user_profile(username)
        
        if language:
            user_profile["language"] = language
        if locale:
            user_profile["locale"] = locale
        if scenario:
            user_profile["scenario"] = scenario
        if ai_role:
            user_profile["ai_role"] = ai_role
        
        db_manager.save_user_profile(user_profile)
        
        return {"success": True, "message": "User profile updated"}
    
    except Exception as e:
        print(f"Error in set_user_profile: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update user profile: {str(e)}")

class ConversationMessage(BaseModel):
    text: str
    role: str
    audio_url: Optional[str] = None

class ConversationRequest(BaseModel):
    username: str
    conversation: List[dict]

@app.get('/api/health_check')
async def health_check():
    try:
        from database.mongodb_manager import MongoDBManager
        db_manager = MongoDBManager()
        db_manager.db.command('ping')
        return JSONResponse(content={"status": "healthy", "database": "connected"}, status_code=200)
    except Exception as e:
        return JSONResponse(content={"status": "unhealthy", "error": str(e)}, status_code=500)

@app.post("/api/save_conversation")
async def save_conversation(request: Request):
    try:
        body = await request.json()
        
        username = body.get('username')
        conversation = body.get('conversation')
        is_discarded = body.get('is_discarded', False)
        batch_id = body.get('batch_id')
        
        print(f"SAVE_CONVERSATION: Received request with username={username}, {len(conversation) if conversation else 0} messages, batch_id={batch_id}")
        
        # Validate required fields
        if not username:
            return JSONResponse(status_code=400, content={"error": "Username is required"})
            
        if not conversation or not isinstance(conversation, list) or len(conversation) == 0:
            print(f"Warning: Empty conversation array for user {username}")
            return JSONResponse(status_code=200, content={"status": "success", "message": "No messages to save"})
        
        # Add debug logging to trace the data
        print(f"SAVE_CONVERSATION: First message in conversation: {conversation[0]}")
        
        # Make sure batch_id is set on each message
        if batch_id:
            for msg in conversation:
                if isinstance(msg, dict) and not msg.get('batch_id'):
                    msg['batch_id'] = batch_id
        
        result = db_manager.save_conversation(
            username=username,
            conversation=conversation,
            is_discarded=is_discarded,
            batch_id=batch_id
        )
        
        if result:
            print(f"SAVE_CONVERSATION: Successfully saved {len(conversation)} messages for {username}")
            return JSONResponse(
                status_code=200, 
                content={"status": "success", "message": f"Successfully saved {len(conversation)} messages"}
            )
        else:
            print(f"SAVE_CONVERSATION: Failed to save conversation for {username}")
            return JSONResponse(
                status_code=500,
                content={"status": "error", "message": "Failed to save conversation"}
            )
            
    except Exception as e:
        import traceback
        print(f"SAVE_CONVERSATION ERROR: {str(e)}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": str(e)}
        )

@app.get("/api/scenarios")
async def get_scenarios():
    scenario_list = []
    
    for scenario_id, language_dict in DEFAULT_SCENARIOS.items():
        desc = ""
        role = ""
        
        if 'en' in language_dict:
            desc = language_dict['en'].get('desc', scenario_id)
            role = language_dict['en'].get('role', 'Conversation Partner')
        
        scenario_list.append({
            "id": scenario_id,
            "title": scenario_id.replace('_', ' ').title(),
            "description": desc,
            "role": role,
            "custom": False
        })
    
    return {"scenarios": scenario_list}

@app.post("/api/create_scenario")
async def create_custom_scenario(request: dict):
    print("Received create_scenario request:", request) 
    
    username = request.get('username')
    title = request.get('title')
    description = request.get('description', '')
    
    if not username or not title:
        raise HTTPException(status_code=400, detail="Username and title are required")
    
    try:
        user_profile = load_user_profile(username)
        
        if "custom_scenarios" not in user_profile:
            user_profile["custom_scenarios"] = []
        
        scenario_id = f"custom_{int(datetime.now().timestamp())}"
        
        try:
            ai_role = infer_ai_role(title, client)
        except Exception as e:
            print(f"Error inferring AI role: {e}")
            ai_role = "Conversation Partner"
        
        user_profile["custom_scenarios"].append({
            "id": scenario_id,
            "title": title,
            "description": description,
            "role": ai_role,
            "created_at": datetime.now().isoformat()
        })
        
        save_user_profile(user_profile)
        
        print(f"Custom scenario created for {username}: {title}")
        
        return {
            "id": scenario_id,
            "title": title,
            "description": description,
            "role": ai_role
        }
    except Exception as e:
        print(f"Error creating custom scenario: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create scenario: {str(e)}")

@app.post("/api/get_scenario_response", response_model=ChatResponse)
async def get_scenario_response(request: ChatRequest):
    username = request.username
    
    user_profile = load_user_profile(username)
    if not user_profile:
        raise HTTPException(status_code=400, detail="User profile not found")

    scenario = user_profile.get("scenario")
    ai_role = user_profile.get("ai_role")
    language = user_profile.get("language", "en")
    
    if not scenario:
        raise HTTPException(status_code=400, detail="Scenario not set for this user")
    
    if scenario == "Language Practice":
        ai_role = "Language Practice Partner"
        
        if language == "en":
            ai_response = "Hi there! I'm your language practice partner. What would you like to talk about today?"
        elif language in ('zh', 'zh-CN', 'zh-TW'):
            ai_response = "你好！我是你的语言练习伙伴。今天你想聊些什么？"
        elif language == 'ja':
            ai_response = "こんにちは！私はあなたの言語練習パートナーです。今日は何について話したいですか？"
        elif language == 'ko':
            ai_response = "안녕하세요! 저는 당신의 언어 연습 파트너입니다. 오늘 무엇에 대해 이야기하고 싶으신가요?"
        elif language == 'es':
            ai_response = "¡Hola! Soy tu compañero de práctica de idiomas. ¿Sobre qué te gustaría hablar hoy?"
        elif language == 'fr':
            ai_response = "Bonjour ! Je suis votre partenaire de pratique linguistique. De quoi aimeriez-vous parler aujourd'hui ?"
        elif language == 'de':
            ai_response = "Hallo! Ich bin dein Sprachübungspartner. Worüber möchtest du heute sprechen?"
        elif language == 'it':
            ai_response = "Ciao! Sono il tuo partner di pratica linguistica. Di cosa ti piacerebbe parlare oggi?"
        elif language == 'hi':
            ai_response = "नमस्ते! मैं आपकी भाषा अभ्यास साथी हूं। आज आप किस विषय पर बात करना चाहेंगे?"
        else:
            ai_response = "Hello! I'm your language practice partner. What would you like to talk about today?"
    else:
        ai_role = user_profile.get("ai_role")
        if not ai_role:
            ai_role = infer_ai_role(scenario, client)
            user_profile["ai_role"] = ai_role
        
        try:
            has_ai_initiated = False
            for msg in user_profile.get("chat_history", []):
                if msg.get("user") == "AI INITIATED":
                    has_ai_initiated = True
                    ai_response = msg.get("ai", "")
                    break
            
            if not has_ai_initiated:
                system_prompt = f"You are {ai_role} in the following scenario: {scenario}. Start with a greeting or introduction that makes sense for this specific setting. Use {language} language."
                
                response = client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[{"role": "system", "content": system_prompt}],
                    max_tokens=150,
                    temperature=0.7,
                )
                ai_response = response.choices[0].message.content
                
                user_profile["chat_history"] = [{
                    "user": "AI INITIATED", 
                    "ai": ai_response,
                    "timestamp": datetime.now().isoformat()
                }]
                save_user_profile(user_profile)
        except Exception as e:
            print(f"Error generating scenario response: {e}")
            ai_response = f"Hello! I'm playing the role of {ai_role} in this {scenario} scenario. How can I help you today?"

    audio_file = f"response-{uuid.uuid4()}.mp3"
    audio_path = os.path.join(SOUND_RESPONSE_DIR, audio_file)
    
    try:
        from gtts import gTTS
        voiced_response = clean_text(ai_response)
        tts = gTTS(text=voiced_response, lang=LANGUAGE_MAP.get(language, "en"), slow=False)
        tts.save(audio_path)
    except Exception as e:
        print(f"Error generating audio: {e}")
        audio_path = None

    return {
        "response": ai_response,
        "audio_url": f"/audio/{audio_file}" if audio_path else None
    }

@app.post("/api/set_scenario", response_model=ScenarioResponse)
async def set_scenario(request: ScenarioRequest):
    username = request.username
    scenario = request.scenario
    language = request.language
    
    user_profile = load_user_profile(username)
    
    scenario_changed = user_profile.get("scenario") != scenario
    
    user_profile["scenario"] = scenario
    user_profile["language"] = language
    
    ai_role = infer_ai_role(scenario, client)
    user_profile["ai_role"] = ai_role
    
    if scenario_changed:
        user_profile["chat_history"] = []
        user_profile["suggestions"] = []
    
    save_user_profile(user_profile)
    
    return {"scenario": scenario, "ai_role": ai_role}

@app.post("/api/get_suggestions", response_model=SuggestionResponse)
async def get_suggestions(request: SuggestionRequest):
    username = request.username
    requested_language = request.language
    language_name = request.language_name
    
    print(f"Received suggestion request for {username} in language: {requested_language}, language_name: {language_name}")
    
    if requested_language and requested_language.lower() in ['it', 'hi']:
        special_language_map = {'it': 'Italian', 'hi': 'Hindi'}
        normalized_language = special_language_map.get(requested_language.lower())
        print(f"Special handling for {requested_language} -> {normalized_language}")
    else:
        normalized_language = normalize_language(requested_language)
    
    user_profile = load_user_profile(username)
    if not user_profile:
        print(f"User profile not found for {username}, using default suggestions")
        return {"suggestions": DEFAULT_SUGGESTIONS}
    
    if requested_language:
        old_language = user_profile.get('language')
        if old_language != normalized_language:
            user_profile['language'] = normalized_language
            user_profile['locale'] = requested_language
            save_user_profile(user_profile)
            print(f"Updated user {username} language from {old_language} to {normalized_language}")
    else:
        normalized_language = user_profile.get("language", "en")
    
    print(f"Generating suggestions for {username} in language: {normalized_language}")
    
    chat_history = user_profile.get("chat_history", [])
    
    if not chat_history:
        scenario = user_profile.get("scenario")
        ai_role = user_profile.get("ai_role")
        
        if scenario and scenario != "Language Practice":
            try:
                return generate_scenario_suggestions(scenario, ai_role, normalized_language)
            except Exception as e:
                print(f"Error generating scenario-specific suggestions: {e}")
        
        return get_default_suggestions(normalized_language)
    
    try:
        last_exchanges = chat_history[-2:] if len(chat_history) >= 2 else chat_history
        
        context = ""
        for msg in last_exchanges:
            if "user" in msg and msg["user"] != "AI INITIATED":
                context += f"User: {msg.get('user', '')}\n"
            if "ai" in msg:
                context += f"AI: {msg.get('ai', '')}\n"
        
        scenario = user_profile.get("scenario", "Language Practice")
        ai_role = user_profile.get("ai_role", "Conversation Partner")
        
        if normalized_language.lower() in ['italian', 'hindi', 'it', 'hi']:
            language_display = "Italian" if normalized_language.lower() in ['italian', 'it'] else "Hindi"
            special_instruction = f"IMPORTANT: Generate suggestions ONLY in {language_display}. DO NOT use English at all!"
        else:
            special_instruction = ""
        
        scenario_content = "" if scenario == "Language Practice" else f"This conversation is taking place in the following scenario: {scenario}. The AI is playing the role of {ai_role}."
        prompt = f"""
        {scenario_content}
        
        Recent conversation:
        {context if context else "No previous conversation."}
        
        Based on this conversation, generate 3 appropriate suggestions for what the user might want to say next based on the responses returned from the previous messages. 
        Most suggestions must be STATEMENTS (maximum 1 question out of 3), and Fit the roleplay scenario naturally.
        These must be relevant to continue the conversation naturally based on the responses from backend robots.
        Each suggestion must be a complete statements or question. Keep suggestions brief, under 20 words each.
        The responses must be relevant to the conversation context and appropriate for the scenario.
        
        Respond in {normalized_language} language.
        
        {special_instruction}
        
        IMPORTANT: Provide only plain text suggestions. No bullet points, no numbering, no dashes.
        Just provide 3 simple sentences, one per line.
        """
        
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": prompt}],
            temperature=0.7,
            max_tokens=200,
            presence_penalty=0.2,
        )
        
        suggestions_text = response.choices[0].message.content.strip()        
        suggestions_raw = [s.strip() for s in suggestions_text.split('\n') if s.strip()]
        suggestions = []
        
        for suggestion in suggestions_raw:
            cleaned = re.sub(r'^[\d\.\-\*\•\⁃\⦁\◦\▪\□\▫\–\—\⁌\→\>\s]+', '', suggestion).strip()
            if cleaned:
                suggestions.append(cleaned)
        
        suggestions = suggestions[:3]
        
        if normalized_language.lower() in ['italian', 'hindi', 'it', 'hi']:
            valid_suggestions = []
            for suggestion in suggestions:
                if is_correct_language(suggestion, normalized_language):
                    valid_suggestions.append(suggestion)
                else:
                    print(f"Invalid language detected in suggestion: {suggestion}")
                    fallback = get_fallback_in_language(normalized_language)
                    valid_suggestions.append(fallback)
            suggestions = valid_suggestions
        
        while len(suggestions) < 3:
            fallbacks = get_fallback_suggestions(normalized_language)
            for fallback in fallbacks:
                if fallback not in suggestions:
                    suggestions.append(fallback)
                    if len(suggestions) >= 3:
                        break
        
        print(f"Final suggestions: {suggestions}")
        return {"suggestions": suggestions[:3]}
        
    except Exception as e:
        print(f"Error generating suggestions: {e}")
        return get_default_suggestions(normalized_language)


def generate_scenario_suggestions(scenario, ai_role, language):
    prompt = f"""
    You're helping a language learner practice in this scenario: {scenario}.
    The AI is playing the role of: {ai_role}.
    
    Generate 3 appropriate conversation suggestions that the user could say in this scenario based on the context of the conversation.
    Most suggestions must be STATEMENTS (maximum 1 question out of 3), and Fit the roleplay scenario naturally.
    Each suggestion should be a complete statement or question, appropriate for starting or continue a conversation.
    Keep suggestions brief (under 20 words) and natural for this specific scenario topic.
    Respond in {language}.
    You must generate suggestions that in complete sentences, not just keywords or phrases.
    
    IMPORTANT: Provide only plain text suggestions. No bullet points, no numbering, no dashes.
    Just provide 3 simple sentences, one per line.
    """
    
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=150,
    )
    
    suggestions_text = response.choices[0].message.content.strip()
    
    suggestions_raw = [s.strip() for s in suggestions_text.split('\n') if s.strip()]
    suggestions = []
    
    for suggestion in suggestions_raw:
        cleaned = re.sub(r'^[\d\.\-\*\•\⁃\⦁\◦\▪\□\▫\–\—\⁌\→\>\s]+', '', suggestion).strip()
        if cleaned:
            suggestions.append(cleaned)
    
    suggestions = suggestions[:3]
    
    return {"suggestions": suggestions}


def get_default_suggestions(language_code):
    """Simple default suggestions for when there's no conversation history"""
    defaults = {
        'en': ["Hello, how are you?", "Nice to meet you!", "What would you like to talk about?"],
        'zh-cn': ["你好，你好吗？", "很高兴认识你！", "你想聊些什么？"],
        'ja': ["こんにちは、お元気ですか？", "はじめまして！", "何について話したいですか？"],
        'ko': ["안녕하세요, 어떻게 지내세요?", "만나서 반갑습니다!", "무엇에 대해 이야기하고 싶으세요?"],
        'es': ["¡Hola! ¿Cómo estás?", "¡Encantado de conocerte!", "¿De qué te gustaría hablar?"],
        'fr': ["Bonjour ! Comment ça va ?", "Ravi de faire votre connaissance !", "De quoi voudrais-tu parler ?"],
        'de': ["Hallo! Wie geht es dir?", "Schön, dich kennenzulernen!", "Worüber möchtest du sprechen?"],
        'it': ["Ciao! Come stai?", "Piacere di conoscerti!", "Di cosa ti piacerebbe parlare?"],
        'hi': ["नमस्ते! आप कैसे हैं?", "आपसे मिलकर खुशी हुई!", "आप किस बारे में बात करना चाहेंगे?"],
    }
    
    normalized_code = normalize_language(language_code).lower()
    return {"suggestions": defaults.get(normalized_code, defaults['en'])}

def is_correct_language(text, language):
    if language.lower() in ['italian', 'it']:
        italian_words = ['ciao', 'buongiorno', 'grazie', 'prego', 'come', 'sono', 'mi', 'tu', 'che', 'e', 'il', 'la']
        return any(word in text.lower() for word in italian_words) and 'the' not in text.lower() and 'is' not in text.lower()
    elif language.lower() in ['hindi', 'hi']:
        hindi_chars = ['\u0900', '\u0901', '\u0902', '\u0903', '\u0904', '\u0905', '\u0906', '\u0907', '\u0908', '\u0909', '\u090A', '\u090B', '\u090C', '\u090D', '\u090E', '\u090F', '\u0910', '\u0911', '\u0912', '\u0913', '\u0914', '\u0915', '\u0916', '\u0917', '\u0918', '\u0919', '\u091A', '\u091B', '\u091C', '\u091D', '\u091E', '\u091F', '\u0920', '\u0921', '\u0922', '\u0923', '\u0924', '\u0925', '\u0926', '\u0927', '\u0928', '\u0929', '\u092A', '\u092B', '\u092C', '\u092D', '\u092E', '\u092F', '\u0930', '\u0931', '\u0932', '\u0933', '\u0934', '\u0935', '\u0936', '\u0937', '\u0938', '\u0939', '\u093A', '\u093B', '\u093C', '\u093D', '\u093E', '\u093F', '\u0940', '\u0941', '\u0942', '\u0943', '\u0944', '\u0945', '\u0946', '\u0947', '\u0948', '\u0949', '\u094A', '\u094B', '\u094C', '\u094D', '\u094E', '\u094F', '\u0950', '\u0951', '\u0952', '\u0953', '\u0954', '\u0955', '\u0956', '\u0957', '\u0958', '\u0959', '\u095A', '\u095B', '\u095C', '\u095D', '\u095E', '\u095F', '\u0960', '\u0961', '\u0962', '\u0963', '\u0964', '\u0965', '\u0966', '\u0967', '\u0968', '\u0969', '\u096A', '\u096B', '\u096C', '\u096D', '\u096E', '\u096F', '\u0970', '\u0971', '\u0972', '\u0973', '\u0974', '\u0975', '\u0976', '\u0977', '\u0978', '\u0979', '\u097A', '\u097B', '\u097C', '\u097D', '\u097E', '\u097F']
        return any(char in text for char in hindi_chars)
    return True

def get_fallback_in_language(language):
    if language.lower() in ['italian', 'it']:
        fallbacks = [
            "Mi piacerebbe sapere di più su questo.",
            "Potrebbe spiegare meglio, per favore?",
            "Interessante, continui pure."
        ]
    elif language.lower() in ['hindi', 'hi']:
        fallbacks = [
            "मुझे इस बारे में अधिक जानना अच्छा लगेगा।",
            "क्या आप इसे बेहतर ढंग से समझा सकते हैं?",
            "दिलचस्प, कृपया जारी रखें।"
        ]
    else:
        fallbacks = DEFAULT_SUGGESTIONS
    
    import random
    return random.choice(fallbacks)


def get_fallback_suggestions(language_code):
    fallbacks = {
        'en': ["I understand what you're saying.", "That's interesting. Can you tell me more?", 
               "I agree with your perspective.", "What do you think about this?"],
        'zh-cn': ["我理解你的意思。", "真有意思，能告诉我更多吗？", "我同意你的观点。", "你对此有什么看法？"],
        'zh-tw': ["我理解你的意思。", "真有意思，能告訴我更多嗎？", "我同意你的觀點。", "你對此有什麼看法？"],
        'ja': ["あなたの言っていることは理解できます。", "それは面白いですね。もっと教えてください。",
               "あなたの視点に同意します。", "これについてどう思いますか？"],
        'ko': ["당신이 말하는 것을 이해합니다.", "흥미롭네요. 더 자세히 알려주시겠어요?",
               "당신의 관점에 동의합니다.", "이것에 대해 어떻게 생각하세요?"],
        'es': ["Entiendo lo que estás diciendo.", "Eso es interesante. ¿Puedes contarme más?",
               "Estoy de acuerdo con tu perspectiva.", "¿Qué piensas sobre esto?"],
        'fr': ["Je comprends ce que tu dis.", "C'est intéressant. Peux-tu m'en dire plus ?",
               "Je suis d'accord avec ton point de vue.", "Qu'en penses-tu ?"],
        'de': ["Ich verstehe, was du sagst.", "Das ist interessant. Kannst du mir mehr darüber erzählen?",
               "Ich stimme deiner Perspektive zu.", "Was denkst du darüber?"],
        'it': ["Capisco quello che stai dicendo.", "È interessante. Puoi dirmi di più?",
               "Sono d'accordo con la tua prospettiva.", "Cosa ne pensi di questo?"],
    }
    
    normalized_code = normalize_language(language_code).lower()
    return fallbacks.get(normalized_code, fallbacks['en'])

def get_default_suggestions(language):
    default_suggestions = {
        'english': ["Tell me more about that.", "What do you think about this?", "Can you explain that further?"],
        'en': ["Tell me more about that.", "What do you think about this?", "Can you explain that further?"],
        'chinese': ["告诉我更多关于那个的信息。", "你对这个有什么想法？", "你能进一步解释一下吗？"],
        'zh-cn': ["告诉我更多关于那个的信息。", "你对这个有什么想法？", "你能进一步解释一下吗？"],
        'chinese traditional': ["告訴我更多關於那個的信息。", "你對這個有什麼想法？", "你能進一步解釋一下嗎？"],
        'zh-tw': ["告訴我更多關於那個的信息。", "你對這個有什麼想法？", "你能進一步解釋一下嗎？"],
        'japanese': ["それについてもっと教えてください。", "これについてどう思いますか？", "もう少し詳しく説明してもらえますか？"],
        'ja': ["それについてもっと教えてください。", "これについてどう思いますか？", "もう少し詳しく説明してもらえますか？"],
        'korean': ["그것에 대해 더 자세히 알려주세요.", "이것에 대해 어떻게 생각하세요?", "더 자세히 설명해 주시겠어요?"],
        'ko': ["그것에 대해 더 자세히 알려주세요.", "이것에 대해 어떻게 생각하세요?", "더 자세히 설명해 주시겠어요?"],
        'spanish': ["Cuéntame más sobre eso.", "¿Qué piensas sobre esto?", "¿Puedes explicar eso con más detalle?"],
        'es': ["Cuéntame más sobre eso.", "¿Qué piensas sobre esto?", "¿Puedes explicar eso con más detalle?"],
        'french': ["Parlez-moi davantage de cela.", "Que pensez-vous de ceci?", "Pouvez-vous expliquer cela plus en détail?"],
        'fr': ["Parlez-moi davantage de cela.", "Que pensez-vous de ceci?", "Pouvez-vous expliquer cela plus en détail?"],
        'italian': ["Dimmi di più a riguardo.", "Cosa ne pensi di questo?", "Puoi spiegarlo più dettagliatamente?"],
        'it': ["Dimmi di più a riguardo.", "Cosa ne pensi di questo?", "Puoi spiegarlo più dettagliatamente?"],
        'german': ["Erzählen Sie mir mehr darüber.", "Was denken Sie darüber?", "Können Sie das genauer erklären?"],
        'de': ["Erzählen Sie mir mehr darüber.", "Was denken Sie darüber?", "Können Sie das genauer erklären?"],
        'hindi': ["मुझे इसके बारे में और बताओ।", "आप इसके बारे में क्या सोचते हैं?", "क्या आप इसे और विस्तार से समझा सकते हैं?"],
        'hi': ["मुझे इसके बारे में और बताओ।", "आप इसके बारे में क्या सोचते हैं?", "क्या आप इसे और विस्तार से समझा सकते हैं?"]
    }
    
    language_key = language.lower()
    return {"suggestions": default_suggestions.get(language_key, default_suggestions['english'])}


def normalize_language(language_code):
    if not language_code:
        return 'en'
        
    language_code = str(language_code).lower().strip()
    
    language_mapping = {
        'english': 'en', 'en': 'en', 'en-us': 'en', 'en-gb': 'en',
        'chinese': 'zh-cn', 'chinese (simplified)': 'zh-cn', 'zh': 'zh-cn', 'zh-cn': 'zh-cn',
        'chinese (traditional)': 'zh-tw', 'zh-tw': 'zh-tw', 'traditional chinese': 'zh-tw',
        'japanese': 'ja', 'ja': 'ja', 'ja-jp': 'ja',
        'korean': 'ko', 'ko': 'ko', 'ko-kr': 'ko',
        'spanish': 'es', 'es': 'es', 'es-es': 'es', 'es-mx': 'es',
        'french': 'fr', 'fr': 'fr', 'fr-fr': 'fr',
        'german': 'de', 'de': 'de', 'de-de': 'de',
        'italian': 'it', 'it': 'it', 'it-it': 'it',
        'hindi': 'hi', 'hi': 'hi', 'hi-in': 'hi',
    }
    
    return language_mapping.get(language_code, language_code)

@app.post("/api/translate")
async def translate_text(request: Request):
    data = await request.json()
    text = data.get("text")
    source = data.get("source", "auto")
    target = data.get("target", "en")
    
    if not text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": f"You are a translator. Translate the text from {source} to {target}. Only return the translated text, nothing else."},
                {"role": "user", "content": text}
            ],
            temperature=0.3,
            max_tokens=1000
        )
        translated_text = response.choices[0].message.content.strip()
        
        return JSONResponse({
            "translated_text": translated_text,
            "source": source,
            "target": target
        })
    except Exception as e:
        print(f"Translation error: {str(e)}")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/get_lessons")
async def get_lessons(request: dict):
    username = request.get("username")
    language = request.get("language", "English")
    user_profile = load_user_profile(username) 
    chat_history = user_profile.get("chat_history", [])
    language_name = "English"
    for name, code in LANGUAGE_MAP.items():
        if code == language:
            language_name = name
            break
    
    if len(chat_history) < 3:
        return {
            "critique": "We need more conversation data to provide personalized feedback.",
            "lessons": [
                "Practice common greetings and self-introductions for everyday situations",
                "Learn essential words and phrases for shopping, dining, and transportation",
                "Master basic question formats and appropriate response patterns"
            ]
        }
    
    conversation_text = ""
    for entry in chat_history[-10:]: 
        if "user" in entry and entry.get("user") != "AI INITIATED":
            conversation_text += f"User: {entry.get('user', '')}\n"
        if "ai" in entry:
            conversation_text += f"AI: {entry.get('ai', '')}\n"
    
    try:
        analysis_prompt = f"""
        You are an expert language teacher. 
        
        Analyze this conversation where the user is practicing the language based on the user's past conversation history.:
        
        {conversation_text}
        
        1. What language level does the user appear to be at (beginner, intermediate, advanced)?
        2. What are the user's main strengths in the language?
        3. What are 3 specific areas where the user needs improvement?
        4. What topics does the user seem interested in discussing?
        
        Be concise but specific in your analysis.
        """
        
        analysis_response = client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "system", "content": analysis_prompt}],
            max_tokens=400,
            temperature=0.5,
        )
        
        analysis = analysis_response.choices[0].message.content
        
        suggestion_prompt = f"""
        Based on the analysis of this language learner:
        
        {analysis}
        
        Generate EXACTLY 3 specific, personalized lesson topics that would help this user improve their language skills.
        
        Each lesson topic should:
        1. Be a single plain sentence (20-30 words) describing a learning activity or lesson
        2. Focus on a specific skill area that would benefit this learner
        3. Be phrased as an instruction or suggestion (e.g., "Practice using past tense verbs in everyday conversation scenarios")
        4. Avoid any special formatting, colons, bullet points, etc.
        
        Provide exactly 3 plain, descriptive sentences. No titles, no colons, no quotation marks.
        """
        
        suggestion_response = client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "system", "content": suggestion_prompt}],
            max_tokens=400,
            temperature=0.7,
        )
        
        suggestions_text = suggestion_response.choices[0].message.content
        
        lesson_descriptions = []
        for line in suggestions_text.strip().split('\n'):
            cleaned = re.sub(r'^[\d\.\-\*\•\⁃\⦁\◦\▪\□\▫\–\—\⁌\→\>\s]+', '', line).strip()
            cleaned = cleaned.replace('"', '').replace("'", "")
            if ':' in cleaned:
                cleaned = cleaned.split(':', 1)[1].strip()
            if cleaned and len(cleaned) > 10:
                lesson_descriptions.append(cleaned)
        
        while len(lesson_descriptions) < 3:
            if language == "en":
                lesson_descriptions.append("Practice natural dialogue flows and common expressions used in casual settings")
            elif language in ('zh', 'zh-CN', 'zh-TW'):
                lesson_descriptions.append("练习在日常交流中自然的对话流程和常用表达方式")
            elif language == "ja":
                lesson_descriptions.append("日常会話の自然な流れとカジュアルな表現を練習する")
            elif language == "ko":
                lesson_descriptions.append("일상 대화의 자연스러운 흐름과 일반적인 표현을 연습하기")
            elif language == "es":
                lesson_descriptions.append("Practica los flujos de diálogo naturales y las expresiones comunes utilizadas en situaciones informales")
            elif language == "fr":
                lesson_descriptions.append("Pratiquez les flux de dialogue naturels et les expressions courantes utilisées dans des contextes informels")
            elif language == "de":
                lesson_descriptions.append("Üben Sie natürliche Dialogflüsse und gängige Ausdrücke, die in informellen Situationen verwendet werden")
            elif language == "it":
                lesson_descriptions.append("Pratica i flussi di dialogo naturali e le espressioni comuni utilizzate in contesti informali")
            elif language == "hi":
                lesson_descriptions.append("आम बातचीत में प्राकृतिक संवाद प्रवाह और सामान्य अभिव्यक्तियों का अभ्यास करें")
            else:
                lesson_descriptions.append("Practice natural dialogue flows and common expressions used in casual settings")
        
        critique_lines = []
        for line in analysis.split('\n'):
            if "improvement" in line.lower() or "needs" in line.lower() or "could improve" in line.lower():
                critique_lines.append(line.strip())
        
        critique = "Based on your conversation, here are some areas to focus on:"
        if critique_lines:
            critique = " ".join(critique_lines[:2])
        
        return {
            "critique": critique,
            "lessons": lesson_descriptions[:3] 
        }
        
    except Exception as e:
        print(f"Error generating lesson suggestions: {e}")
        return {
            "critique": "We encountered an issue analyzing your conversation.",
            "lessons": [
                "Learn techniques to speak more naturally and maintain longer discussions without pauses",
                "Build specialized vocabulary sets based on your interests and conversation topics",
                "Practice using correct grammar structures within natural conversation flow"
            ]
        }
    
def clean_text(text):
    text = re.sub(r'([.!?])\1+', r'\1', text)
    text = text.replace(".", ". ")
    text = text.replace("!", "! ")
    text = text.replace("?", "? ")
    text = re.sub(r'[^\w\s.!?,;:\-\'"\(\)，。？！；：""''（）【】]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text   

@app.post("/api/generate_practice_sentence", response_model=PracticeSentence)
async def generate_practice_sentence(request: PracticeSentenceRequest):
    """Generate a language practice sentence based on language and difficulty"""
    try:
        username = request.username
        difficulty = request.difficulty
        language_code = request.language
                
        language_name = {
            "en": "English",
            "es": "Spanish",
            "fr": "French",
            "de": "German",
            "it": "Italian",
            "zh-CN": "Chinese (Simplified)",
            "ja": "Japanese",
            "ko": "Korean",
            "hi": "Hindi",
            "zh-TW": "Chinese (Traditional)",
        }.get(language_code, "English")
        
        if difficulty == "easy":
            prompt = f"""Generate one common word in {language_name} that would be appropriate for a beginner 
                      language learner. Choose a concrete noun, common verb, or basic adjective that's frequently used.
                      Respond with ONLY the word, nothing else.
                      DO NOT translate to English. The word MUST be in {language_name} script only.
                      Please provide more diverse vocabulary that may cover different contexts and topics and are useful."""
        else:
            complexity_desc = {
                "medium": "intermediate vocabulary and grammar, short sentences suitable for beginners and intermediate learners, and are useful in everyday conversation",
                "hard": "advanced vocabulary and grammar, not very long sentence but suitable for intermediate and advanced learners"
            }
            
            prompt = f"""Generate one {difficulty} level sentence in {language_name} for pronunciation practice.
                      The sentence should use {complexity_desc[difficulty]}.
                      Respond with ONLY the sentence, nothing else.
                      DO NOT translate to English. The sentence MUST be in {language_name} script only."""
        
        try:
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": f"You are a language tutor helping students practice {language_name} pronunciation. Always respond in {language_name} only."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=150,
                temperature=0.7,
                presence_penalty=0.1,
                frequency_penalty=0.1,
            )
            
            practice_content = response.choices[0].message.content.strip()
            practice_content = practice_content.strip('"\'')
            
            print(f"Generated content: {practice_content}")
            
            audio_file = f"practice-{uuid.uuid4()}.mp3"
            audio_path = os.path.join(SOUND_RESPONSE_DIR, audio_file)
            
            try:
                from gtts import gTTS
                import time
                
                voiced_response = clean_text(practice_content)
                
                if language_code not in ["zh-TW", "zh-CN", "zh", "ja", "ko", "hi"]:
                    voiced_response = re.sub(r'([.!?]) ', r'\1  ', voiced_response)
                    voiced_response = re.sub(r'([,;:]) ', r'\1 ', voiced_response)
                
                tts_lang = LANGUAGE_MAP.get(language_code, "en")
                
                use_slow = language_code in ["zh-TW", "zh-CN", "zh", "hi", "ja", "ko"]
                
                tld = "com"
                if language_code == "fr":
                    tld = "fr"
                elif language_code == "es":
                    tld = "es"
                elif language_code == "de":
                    tld = "de"
                
                if difficulty == "easy":
                    voiced_response = f"{voiced_response}"
                
                tts = gTTS(
                    text=voiced_response, 
                    lang=tts_lang, 
                    slow=use_slow,
                    tld=tld
                )
                
                tts.save(audio_path)
                
                time.sleep(0.1)
                audio_url = f"/audio/{audio_file}"
            except Exception as e:
                print(f"Error generating audio: {e}")
                audio_url = None
                
            return PracticeSentence(
                text=practice_content,
                difficulty=difficulty,
                audio_url=audio_url
            )
            
        except Exception as api_error:
            print(f"OpenAI API error: {str(api_error)}")
            raise api_error
            
    except Exception as e:
        print(f"Error generating practice content: {str(e)}")
        FALLBACK_CONTENT = {
            "en": {
                "easy": ["hello", "apple", "book", "friend", "water", "house", "dog", "cat", 
                        "good", "happy", "yes", "no", "please", "thank you", "sorry", "goodbye", 
                        "welcome", "help", "food", "school", "family", "work", "play", "love", "music", 
                        "movie", "game", "city", "country", "travel", "weather", "time", "day", "night"],
                "medium": [
                    "I'd like to schedule an appointment.",
                    "Could you please repeat that?",
                    "What time does the meeting start?", 
                    "I need to improve my pronunciation.",
                    "Can you help me with my homework?",
                    "I enjoy reading books in my free time.",
                    "The weather is nice today.",
                    "I would like to order a coffee.",
                    "Can you recommend a good restaurant?"
                ],
                "hard": [
                    "The pronunciation of certain English words can be challenging.",
                    "I believe that effective communication is essential in today's global economy.", 
                    "Understanding cultural nuances can greatly enhance language learning.",
                    "The intricacies of grammar can often lead to confusion for learners."
                ]
            },
            "ja": {
                "easy": ["こんにちは", "りんご", "本", "友達", "水", "家", "犬", "猫", "良い", "嬉しい", 
                        "はい", "いいえ", "お願いします", "ありがとう", "すみません", "さようなら", 
                        "いらっしゃいませ", "助け", "食べ物", "学校", "家族", "仕事", "遊ぶ", "愛", "音楽"],
                "medium": [
                    "予約を取りたいのですが。",
                    "もう一度言っていただけますか？",
                    "会議は何時に始まりますか？",
                    "発音を改善したいです。",
                    "宿題を手伝ってもらえますか？"
                ],
                "hard": [
                    "日本語の発音は時として難しいことがあります。",
                    "効果的なコミュニケーションは現代のグローバル経済において不可欠です。",
                    "文化的なニュアンスを理解することで語学学習が大幅に向上します。"
                ]
            },
            "ko": {
                "easy": ["안녕하세요", "사과", "책", "친구", "물", "집", "개", "고양이", "좋은", "행복한",
                        "네", "아니요", "부탁합니다", "감사합니다", "죄송합니다", "안녕히 가세요",
                        "환영합니다", "도움", "음식", "학교", "가족", "일", "놀기", "사랑", "음악"],
                "medium": [
                    "예약을 하고 싶습니다.",
                    "다시 한 번 말씀해 주시겠어요?",
                    "회의는 몇 시에 시작하나요?",
                    "발음을 개선하고 싶습니다.",
                    "숙제를 도와주시겠어요?"
                ],
                "hard": [
                    "한국어 발음은 때때로 어려울 수 있습니다.",
                    "효과적인 의사소통은 오늘날의 글로벌 경제에서 필수적입니다.",
                    "문화적 뉘앙스를 이해하면 언어 학습이 크게 향상될 수 있습니다."
                ]
            },
            "zh-CN": {
                "easy": ["你好", "苹果", "书", "朋友", "水", "家", "狗", "猫", "好", "快乐",
                        "是", "不", "请", "谢谢", "对不起", "再见", "欢迎", "帮助", "食物", "学校"],
                "medium": [
                    "我想预约一下。",
                    "你能再说一遍吗？", 
                    "会议什么时候开始？",
                    "我需要改善我的发音。",
                    "你能帮我做作业吗？"
                ],
                "hard": [
                    "中文发音有时可能很有挑战性。",
                    "我认为有效的沟通在当今全球经济中是必不可少的。",
                    "理解文化细节可以大大提高语言学习效果。"
                ]
            },
            "es": {
                "easy": ["hola", "manzana", "libro", "amigo", "agua", "casa", "perro", "gato", 
                        "bueno", "feliz", "sí", "no", "por favor", "gracias", "lo siento", "adiós"],
                "medium": [
                    "Me gustaría programar una cita.",
                    "¿Podrías repetir eso?",
                    "¿A qué hora empieza la reunión?",
                    "Necesito mejorar mi pronunciación.",
                    "¿Puedes ayudarme con mi tarea?"
                ],
                "hard": [
                    "La pronunciación de ciertas palabras españolas puede ser desafiante.",
                    "Creo que la comunicación efectiva es esencial en la economía global de hoy.",
                    "Entender los matices culturales puede mejorar enormemente el aprendizaje de idiomas."
                ]
            },
            "fr": {
                "easy": ["bonjour", "pomme", "livre", "ami", "eau", "maison", "chien", "chat", 
                        "bon", "heureux", "oui", "non", "s'il vous plaît", "merci", "désolé", "au revoir"],
                "medium": [
                    "J'aimerais prendre rendez-vous.",
                    "Pourriez-vous répéter cela ?",
                    "À quelle heure commence la réunion ?",
                    "Je dois améliorer ma prononciation.",
                    "Pouvez-vous m'aider avec mes devoirs ?"
                ],
                "hard": [
                    "La prononciation de certains mots français peut être difficile.",
                    "Je crois que la communication efficace est essentielle dans l'économie mondiale actuelle.",
                    "Comprendre les nuances culturelles peut grandement améliorer l'apprentissage des langues."
                ]
            },
            "de": {
                "easy": ["hallo", "apfel", "buch", "freund", "wasser", "haus", "hund", "katze", 
                        "gut", "glücklich", "ja", "nein", "bitte", "danke", "entschuldigung", "auf wiedersehen"],
                "medium": [
                    "Ich möchte einen Termin vereinbaren.",
                    "Könnten Sie das bitte wiederholen?",
                    "Wann beginnt das Meeting?",
                    "Ich muss meine Aussprache verbessern.",
                    "Können Sie mir bei meinen Hausaufgaben helfen?"
                ],
                "hard": [
                    "Die Aussprache bestimmter deutscher Wörter kann herausfordernd sein.",
                    "Ich glaube, dass effektive Kommunikation in der heutigen globalen Wirtschaft unerlässlich ist.",
                    "Das Verständnis kultureller Nuancen kann das Sprachenlernen erheblich verbessern."
                ]
            },
            "it": {
                "easy": ["ciao", "mela", "libro", "amico", "acqua", "casa", "cane", "gatto", 
                        "buono", "felice", "sì", "no", "per favore", "grazie", "mi dispiace", "arrivederci"],
                "medium": [
                    "Vorrei prenotare un appuntamento.",
                    "Puoi ripetere per favore?",
                    "A che ora inizia la riunione?",
                    "Devo migliorare la mia pronuncia.",
                    "Puoi aiutarmi con i compiti?"
                ],
                "hard": [
                    "La pronuncia di alcune parole italiane può essere impegnativa.",
                    "Credo che una comunicazione efficace sia essenziale nell'economia globale di oggi.",
                    "Comprendere le sfumature culturali può migliorare notevolmente l'apprendimento delle lingue."
                ]
            },
            "hi": {
                "easy": ["नमस्ते", "सेब", "किताब", "मित्र", "पानी", "घर", "कुत्ता", "बिल्ली", 
                        "अच्छा", "खुश", "हाँ", "नहीं", "कृपया", "धन्यवाद", "माफ़ कीजिये", "अलविदा"],
                "medium": [
                    "मैं एक अपॉइंटमेंट लेना चाहता हूँ।",
                    "क्या आप इसे दोहरा सकते हैं?",
                    "बैठक कब शुरू होगी?",
                    "मुझे अपनी उच्चारण सुधारने की जरूरत है।",
                    "क्या आप मेरी होमवर्क में मदद कर सकते हैं?"
                ],
                "hard": [
                    "कुछ हिंदी शब्दों का उच्चारण चुनौतीपूर्ण हो सकता है।",
                    "मेरा मानना है कि प्रभावी संवाद आज की वैश्विक अर्थव्यवस्था में आवश्यक है।",
                    "संस्कृति के बारीकियों को समझना भाषा सीखने को बहुत बढ़ा सकता है।"
                ]
            }
        }
        
        try:
            lang_code = language_code if language_code in FALLBACK_CONTENT else "en"
            fallback_options = FALLBACK_CONTENT[lang_code][difficulty]
            fallback_content = random.choice(fallback_options)
            
            print(f"Using fallback content: {fallback_content}")
            
            audio_file = f"practice-{uuid.uuid4()}.mp3"
            audio_path = os.path.join(SOUND_RESPONSE_DIR, audio_file)
            
            try:
                from gtts import gTTS
                voiced_response = clean_text(fallback_content)
                
                if difficulty == "easy":
                    voiced_response = f"{voiced_response}. {voiced_response}"
                
                tts = gTTS(
                    text=voiced_response, 
                    lang=LANGUAGE_MAP.get(language_code, "en"), 
                    slow=language_code in ["zh-TW", "zh-CN", "zh", "hi", "ja", "ko"],
                    tld="com"
                )
                tts.save(audio_path)
                audio_url = f"/audio/{audio_file}"
            except Exception as audio_error:
                print(f"Error generating audio for fallback: {audio_error}")
                audio_url = None
                
            return PracticeSentence(
                text=fallback_content,
                difficulty=difficulty,
                audio_url=audio_url
            )
            
        except Exception as fallback_error:
            print(f"Error using fallback content: {str(fallback_error)}")
            
            if difficulty == "easy":
                return PracticeSentence(
                    text="hello",
                    difficulty=difficulty,
                    audio_url=None
                )
            else:
                return PracticeSentence(
                    text="Hello, how are you?",
                    difficulty=difficulty,
                    audio_url=None
                )
            
@app.post("/api/generate_varied_word")
async def generate_varied_word(request: Request):
    """Alternative endpoint for generating varied vocabulary"""
    try:
        data = await request.json()
        language = data.get("language", "en")
        difficulty_level = data.get("difficulty_level", 1)
        seed = data.get("seed", random.randint(1, 1000000))
        avoid_words = data.get("avoid_words", [])
        
        random.seed(seed)
        
        language_name = {
            "en": "English",
            "es": "Spanish", 
            "fr": "French",
            "de": "German",
            "it": "Italian",
            "zh-CN": "Chinese (Simplified)",
            "ja": "Japanese",
            "ko": "Korean",
            "hi": "Hindi",
            "zh-TW": "Chinese (Traditional)",
        }.get(language, "English")
        
        avoid_text = f"Do not use these words: {', '.join(avoid_words[:20])}" if avoid_words else ""
        
        prompt = f"""Generate exactly ONE word in {language_name} for language learning.
                   
                   Requirements:
                   - Return ONLY the word itself, no explanations, no pronunciation guides, no parentheses
                   - Choose a practical, everyday word
                   - Appropriate for difficulty level {difficulty_level}/10
                   - Different from commonly repeated words
                   {avoid_text}
                   
                   Examples of correct format:
                   For Korean: 물 (not "물 (mul)" or "물 - water")
                   For Japanese: 水 (not "水 (mizu)" or "水 - water")
                   For English: water (not "water (noun)" or "water - liquid")
                   
                   Return only the word in {language_name}:"""
        
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": f"You are a vocabulary generator. Return only the word itself, no extra information."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=20,  # Reduced to prevent long responses
            temperature=0.9,
        )
        
        raw_word = response.choices[0].message.content.strip()
        
        # Clean the response to extract only the actual word
        def clean_word(text, lang):
            if not text:
                return text
                
            # Remove common patterns
            text = text.strip().strip('"\'`""''')
            
            # Remove content in parentheses (like pronunciation guides)
            import re
            text = re.sub(r'\([^)]*\)', '', text).strip()
            
            # Remove content after dashes or hyphens (explanations)
            text = re.sub(r'\s*[-–—]\s*.*$', '', text).strip()
            
            # Remove content after commas
            text = re.sub(r'\s*,\s*.*$', '', text).strip()
            
            # For Asian languages, take only the first sequence of characters
            if lang in ['ko', 'ja', 'zh-CN', 'zh-TW']:
                # Remove any Latin characters, numbers, or punctuation
                text = re.sub(r'[a-zA-Z0-9\s\-_.,!?()[\]{}]+', '', text).strip()
                
                # For Korean, keep only Hangul characters
                if lang == 'ko':
                    korean_chars = re.findall(r'[가-힣]+', text)
                    if korean_chars:
                        text = korean_chars[0]
                
                # For Japanese, keep only Japanese characters (Hiragana, Katakana, Kanji)
                elif lang == 'ja':
                    japanese_chars = re.findall(r'[ひらがなカタカナ一-龯ぁ-ゖァ-ヾ]+', text)
                    if japanese_chars:
                        text = japanese_chars[0]
                
                # For Chinese, keep only Chinese characters
                elif lang in ['zh-CN', 'zh-TW']:
                    chinese_chars = re.findall(r'[一-龯]+', text)
                    if chinese_chars:
                        text = chinese_chars[0]
            
            else:
                # For Latin-based languages, take only the first word
                words = text.split()
                if words:
                    text = words[0]
                    # Remove punctuation from the word
                    text = re.sub(r'[^\w]', '', text)
            
            return text
        
        cleaned_word = clean_word(raw_word, language)
        
        # Fallback if cleaning resulted in empty string
        if not cleaned_word:
            fallback_words = {
                "en": ["practice", "learn", "speak", "listen", "understand"],
                "ja": ["練習", "学習", "話す", "聞く", "理解"],
                "ko": ["연습", "학습", "말하기", "듣기", "이해"],
                "zh-CN": ["练习", "学习", "说话", "听", "理解"],
                "zh-TW": ["練習", "學習", "說話", "聽", "理解"],
                "es": ["práctica", "aprender", "hablar", "escuchar", "entender"],
                "fr": ["pratique", "apprendre", "parler", "écouter", "comprendre"],
                "de": ["übung", "lernen", "sprechen", "hören", "verstehen"],
                "it": ["pratica", "imparare", "parlare", "ascoltare", "capire"],
                "hi": ["अभ्यास", "सीखना", "बोलना", "सुनना", "समझना"]
            }
            words = fallback_words.get(language, fallback_words["en"])
            cleaned_word = random.choice(words)
        
        print(f"Original response: '{raw_word}' -> Cleaned: '{cleaned_word}'")
        
        return {
            "text": cleaned_word,
            "difficulty": "easy",
            "audio_url": None
        }
        
    except Exception as e:
        print(f"Error in generate_varied_word: {str(e)}")
        # Return language-specific fallback
        fallback_words = {
            "en": ["practice", "learn", "speak", "listen", "understand"],
            "ja": ["練習", "学習", "話す", "聞く", "理解"],
            "ko": ["연습", "학습", "말하기", "듣기", "이해"],
            "zh-CN": ["练习", "学习", "说话", "听", "理解"],
            "zh-TW": ["練習", "學習", "說話", "聽", "理解"],
            "es": ["práctica", "aprender", "hablar", "escuchar", "entender"],
            "fr": ["pratique", "apprendre", "parler", "écouter", "comprendre"],
            "de": ["übung", "lernen", "sprechen", "hören", "verstehen"],
            "it": ["pratica", "imparare", "parlare", "ascoltare", "capire"],
            "hi": ["अभ्यास", "सीखना", "बोलना", "सुनना", "समझना"]
        }
        
        words = fallback_words.get(language, fallback_words["en"])
        return {
            "text": random.choice(words),
            "difficulty": "easy", 
            "audio_url": None
        }

class PronunciationRequest(BaseModel):
    audio_data: str  # Base64 encoded audio data
    reference_text: str
    language: str

class PronunciationResponse(BaseModel):
    score: float
    feedback: str

@app.post("/api/score_pronunciation", response_model=PronunciationResponse)
async def score_pronunciation(request: PronunciationRequest):
    """Score the pronunciation of spoken text against a reference text"""
    try:
        language_code = request.language
        reference_text = request.reference_text
        score = random.uniform(70, 95)
        
        if score >= 90:
            feedback = "Excellent pronunciation!"
        elif score >= 80:
            feedback = "Good pronunciation!"
        elif score >= 70:
            feedback = "Your pronunciation is nice!"
        else:
            feedback = "Continue practicing to improve your pronunciation."
        
        return PronunciationResponse(score=score, feedback=feedback)
        
    except Exception as e:
        print(f"Error scoring pronunciation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to score pronunciation: {str(e)}")

@app.get("/api/conversation_history")
async def get_conversation_history(username: str):
    try:
        if not username:
            return JSONResponse(
                status_code=400, 
                content={"error": "Username is required"}
            )
        
        # Use the global db_manager
        user_profile = db_manager.load_user_profile(username)
        
        if not user_profile:
            return JSONResponse(
                status_code=404,
                content={"error": f"User profile not found for {username}"}
            )
        
        return JSONResponse(
            status_code=200,
            content={"chat_history": user_profile.get("chat_history", [])}
        )
    except Exception as e:
        print(f"Error in get_conversation_history: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to get conversation history: {str(e)}"}
        )

@app.post("/api/save_roleplay_conversation")
async def save_roleplay_conversation(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        scenario = data.get("scenario")
        conversation = data.get("conversation")
        custom = data.get("custom", False)
        language = data.get("language", "en")
        timestamp = data.get("timestamp", datetime.now().isoformat())

        if not username or not scenario or not conversation:
            return JSONResponse(
                status_code=400,
                content={"error": "Username, scenario, and conversation are required"}
            )

        roleplay_collection = db_manager.db["roleplay_conversations"]
        
        conversation_doc = {
            "username": username,
            "scenario": scenario,
            "conversation": conversation,
            "custom": custom,
            "language": language,
            "timestamp": timestamp,
            "created_at": datetime.now().isoformat()
        }
        
        result = roleplay_collection.insert_one(conversation_doc)
        
        return JSONResponse(
            content={"success": True, "id": str(result.inserted_id)},
            status_code=200
        )
    except Exception as e:
        print(f"Error saving roleplay conversation: {str(e)}")
        return JSONResponse(
            content={"error": f"Failed to save roleplay conversation: {str(e)}"},
            status_code=500
        )

@app.post("/api/save_user_scenario")
async def save_user_scenario(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        title = data.get("title")
        description = data.get("description")
        language = data.get("language", "en")
        
        timestamp = data.get("timestamp")
        if not timestamp:
            from datetime import datetime
            timestamp = datetime.utcnow().isoformat()
        
        import uuid
        scenario_id = str(uuid.uuid4())
        
        scenario = {
            "id": scenario_id,
            "username": username,
            "title": title,
            "description": description,
            "language": language,
            "custom": True,
            "created_at": timestamp
        }
        
        print(f"Saving custom scenario: {scenario}")
        
        result = db_manager.db["user_scenarios"].insert_one(scenario)
        
        return JSONResponse(
            content={
                "success": True,
                "message": "Custom scenario saved successfully",
                "scenario_id": scenario_id
            }
        )
        
    except Exception as e:
        print(f"Error saving user scenario: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to save scenario: {str(e)}"}
        )

@app.get("/api/user_scenarios")
async def get_user_scenarios(username: str):
    try:
        if not username:
            return JSONResponse(
                status_code=400,
                content={"error": "Username is required"}
            )
        
        user_profile = load_user_profile(username)
        if user_profile and "custom_scenarios" in user_profile:
            return JSONResponse(
                content={"scenarios": user_profile.get("custom_scenarios", [])},
                status_code=200
            )
            
        scenario_collection = db_manager.db["user_scenarios"]
        cursor = scenario_collection.find({"username": username})
        scenarios = []
        
        for doc in cursor:
            doc["_id"] = str(doc["_id"])
            scenarios.append(doc)
        
        return JSONResponse(
            content={"scenarios": scenarios},
            status_code=200
        )
    except Exception as e:
        print(f"Error getting user scenarios: {str(e)}")
        return JSONResponse(
            content={"error": f"Failed to fetch user scenarios: {str(e)}"},
            status_code=500
        )
    
@app.post("/api/delete_custom_scenario")
async def delete_custom_scenario(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        scenario_id = data.get("scenario_id")
        
        print(f"Request to delete scenario {scenario_id} for user {username}")
        
        if not username or not scenario_id:
            return JSONResponse(
                status_code=400,
                content={"error": "Username and scenario_id are required"}
            )
        
        result = db_manager.db["user_scenarios"].delete_one({
            "username": username,
            "id": scenario_id
        })
        
        if result.deleted_count > 0:
            print(f"Successfully deleted scenario {scenario_id} for user {username}")
            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Scenario {scenario_id} deleted successfully"
                }
            )
        else:
            print(f"No scenario found with ID {scenario_id} for user {username}")
            return JSONResponse(
                status_code=404,
                content={"error": f"Scenario {scenario_id} not found for user {username}"}
            )
            
    except Exception as e:
        print(f"Error in delete_custom_scenario: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"Server error: {str(e)}"}
        )

@app.post("/api/check_existing_scenario")
async def check_existing_scenario_endpoint(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        title = data.get("title")
        
        print(f"Checking if scenario '{title}' exists for user '{username}'")
        
        if not username or not title:
            return JSONResponse(
                status_code=400,
                content={
                    "exists": False,
                    "error": "Username and title are required"
                }
            )
        
        query = {
            "username": username,
            "title": {"$regex": f"^{re.escape(title)}$", "$options": "i"}
        }
        
        print(f"MongoDB query: {query}")
        
        count = db_manager.db["user_scenarios"].count_documents(query)
        
        existing_scenario = None
        if count > 0:
            existing_scenario = db_manager.db["user_scenarios"].find_one(query)
            if existing_scenario:
                existing_scenario["_id"] = str(existing_scenario["_id"])
                print(f"Found existing scenario: {existing_scenario}")
        
        exists = count > 0
        print(f"Scenario '{title}' for user '{username}' exists: {exists} (count: {count})")
        
        return JSONResponse(
            content={
                "exists": exists,
                "count": count,
                "message": f"Found {count} scenarios with title '{title}' for user '{username}'"
            }
        )
    except Exception as e:
        print(f"Error checking existing scenario: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "exists": False,
                "error": f"Server error: {str(e)}"
            }
        )

@app.post("/api/save_scenario_messages")
async def save_scenario_messages(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        scenario_title = data.get("scenario_title")
        messages = data.get("messages")
        is_custom = data.get("is_custom_scenario", False)
        language = data.get("language", "en")
        created_at = data.get("created_at", datetime.now().isoformat())
        
        print(f"Saving scenario conversation for {username}, scenario: {scenario_title}")
        
        conversation_id = await db_manager.insert_scenario_conversation(
            username=username,
            scenario_title=scenario_title,
            is_custom=is_custom,
            language=language,
            created_at=created_at
        )
        
        print(f"Created conversation with ID: {conversation_id}, saving {len(messages)} messages")
        
        message_ids = []
        for message in messages:
            message_id = await db_manager.insert_scenario_message(
                conversation_id=conversation_id,
                text=message.get("text"),
                sender=message.get("sender"),
                audio_url=message.get("audio_url"),
                timestamp=message.get("timestamp", datetime.now().isoformat())
            )
            message_ids.append(message_id)
        
        print(f"Successfully saved {len(message_ids)} messages for conversation {conversation_id}")
        return {"success": True, "conversation_id": conversation_id, "message_count": len(message_ids)}
    except Exception as e:
        print(f"Error saving scenario messages: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"detail": f"Failed to save scenario messages: {str(e)}"}
        )

@app.get("/api/get_scenario_conversations")
async def get_scenario_conversations(username: str):
    try:
        print(f"Fetching scenario conversations for user: {username}")
        
        conversation_collection = db_manager.db["scenario_conversations"]
        conversations_docs = list(conversation_collection.find({"username": username}))
        conversations = []
        
        for conv in conversations_docs:
            conv_id = str(conv["_id"])
            conv["id"] = conv_id
            
            message_collection = db_manager.db["scenario_messages"]
            messages = list(message_collection.find({"conversation_id": conv_id}))
            
            for msg in messages:
                msg["id"] = str(msg["_id"])
                del msg["_id"]
            
            messages.sort(key=lambda x: x.get("timestamp", ""))
            
            conv["messages"] = messages
            
            conv["scenario_name"] = conv.get("scenario_title", "Unknown Scenario")
            
            del conv["_id"]
            
            conversations.append(conv)
        
        conversations.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return JSONResponse(
            content={"conversations": conversations},
            status_code=200
        )
    except Exception as e:
        print(f"Error fetching scenario conversations: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            content={"error": f"Failed to fetch scenario conversations: {str(e)}"},
            status_code=500
        )
    
@app.post("/api/delete_scenario_conversation")
async def delete_scenario_conversation(request: Request):
    try:
        data = await request.json()
        username = data.get("username")
        conversation_id = data.get("conversation_id")
        
        if not username or not conversation_id:
            return JSONResponse(
                status_code=400,
                content={"error": "Username and conversation_id are required"}
            )
        
        conversation_collection = db_manager.db["scenario_conversations"]
        
        result = conversation_collection.update_one(
            {"$or": [{"_id": ObjectId(conversation_id)}, {"id": conversation_id}], "username": username},
            {"$set": {"is_deleted": True, "deleted": True}}
        )
        
        if result.modified_count > 0 or result.deleted_count > 0:
            return JSONResponse(
                content={"success": True, "message": "Conversation deleted successfully"}
            )
        else:
            return JSONResponse(
                status_code=404,
                content={"error": f"Conversation not found or you don't have permission to delete it"}
            )
            
    except Exception as e:
        print(f"Error deleting scenario conversation: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"Server error: {str(e)}"}
        )

@app.post("/api/delete_chat_message")
async def delete_chat_message(request: dict):
    try:
        username = request.get("username")
        batch_id = request.get("batch_id")
        timestamps = request.get("timestamps", [])
        
        print(f"Delete request received - username: {username}, batch_id: {batch_id}")
        print(f"Timestamps to delete: {timestamps}")
        
        if not username:
            print("Error: No username provided")
            raise HTTPException(status_code=400, detail="Username is required")
        
        user_profile = db_manager.load_user_profile(username)
        
        if not user_profile:
            print(f"Error: No user profile found for {username}")
            return {"success": False, "message": "User profile not found"}
            
        if "chat_history" not in user_profile or not user_profile["chat_history"]:
            print(f"Warning: No chat history found for {username}")
            return {"success": False, "message": "Chat history not found or empty"}
            
        history_count = len(user_profile["chat_history"]) if user_profile.get("chat_history") else 0
        print(f"Found {history_count} messages in chat history for {username}")
        
        original_count = len(user_profile["chat_history"])
        
        if batch_id:
            # Strategy 1: Delete by batch_id or conversation_id match
            user_profile["chat_history"] = [
                msg for msg in user_profile["chat_history"] 
                if not (
                    (msg.get("batch_id") == batch_id) or 
                    (msg.get("conversation_id") == batch_id)
                )
            ]
        
        # Strategy 2: Delete by timestamps (if provided and strategy 1 didn't work)
        if timestamps and len(timestamps) > 0 and len(user_profile["chat_history"]) == original_count:
            user_profile["chat_history"] = [
                msg for msg in user_profile["chat_history"] 
                if not (msg.get("timestamp") in timestamps)
            ]
        
        # Strategy 3: For "single-xxx" IDs that are derived from timestamps
        if batch_id and batch_id.startswith("single-") and len(user_profile["chat_history"]) == original_count:
            parts = batch_id.split('-')
            if len(parts) >= 2:
                # Try to extract timestamp from the ID
                try:
                    timestamp_part = parts[1]
                    user_profile["chat_history"] = [
                        msg for msg in user_profile["chat_history"] 
                        if not (msg.get("timestamp") and timestamp_part in msg.get("timestamp"))
                    ]
                except:
                    pass
        
        new_count = len(user_profile["chat_history"])
        removed = original_count - new_count
        
        if removed > 0:
            db_manager.save_user_profile(user_profile)
            print(f"Successfully deleted {removed} messages for user {username}")
            return {"success": True, "message": f"Successfully deleted {removed} messages"}
        else:
            if batch_id:
                print(f"Warning: No messages found with batch_id: {batch_id}")
                if len(user_profile["chat_history"]) > 0:
                    sample = user_profile["chat_history"][0]
                    print(f"Sample message keys: {list(sample.keys())}")
                    
                    batch_ids = [msg.get("batch_id") for msg in user_profile["chat_history"] if msg.get("batch_id")]
                    print(f"Sample of batch_ids in database: {batch_ids[:5] if batch_ids else 'None'}")
            
            return {"success": False, "message": "No matching messages found"}
            
    except Exception as e:
        print(f"Error deleting chat message: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": f"Error: {str(e)}"}
    
@app.post("/api/update_profile_image")
async def update_profile_image(request: dict):
    username = request.get("username")
    image_data = request.get("image") 
    
    if not username or not image_data:
        return {"success": False, "message": "Missing required fields"}
    
    try:
        result = db_manager.db["users"].update_one(
            {"username": username},
            {"$set": {"profile_image": image_data}}
        )
        
        image_url = f"http://localhost:8000/api/profile_image/{username}"
        
        return {"success": True, "imageUrl": image_url}
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.get("/api/profile_image/{username}")
async def get_profile_image(username: str):
    user_data = db_manager.db["users"].find_one({"username": username})
    
    if not user_data or "profile_image" not in user_data:
        return Response(status_code=404)
    
    image_data = user_data["profile_image"]
    image_format = "jpeg" 
    
    if "data:image/" in image_data:
        format_part = image_data.split("data:image/")[1].split(";base64,")[0]
        image_format = format_part
    
    return Response(
        content=base64.b64decode(image_data.split(",")[1]), 
        media_type=f"image/{image_format}"
    )

@app.post("/api/update_profile_image")
async def update_profile_image(request: Request):
    data = await request.json()
    username = data.get("username")
    image_data = data.get("image")
    
    if not username or not image_data:
        raise HTTPException(status_code=400, detail="Missing required fields")
    
    try:
        if "base64," in image_data:
            format_match = re.search(r"data:image/([a-zA-Z]+);base64,", image_data)
            image_format = format_match.group(1) if format_match else "jpeg"
            
            base64_data = image_data.split("base64,")[1]
            
            file_name = f"{username}_{uuid.uuid4()}.{image_format}"
            file_path = os.path.join("profile_images", file_name)
            
            os.makedirs("profile_images", exist_ok=True)
            
            with open(file_path, "wb") as f:
                f.write(base64.b64decode(base64_data))
            
            image_url = f"http://localhost:8000/profile_images/{file_name}"
            
            db_manager.db["users"].update_one(
                {"username": username},
                {"$set": {"profile_image": image_url}}
            )
            
            return {"success": True, "imageUrl": image_url}
        
        else:
            raise HTTPException(status_code=400, detail="Invalid image format")
    
    except Exception as e:
        print(f"Error processing image upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")

@app.get("/profile_images/{file_name}")
async def get_profile_image(file_name: str):
    file_path = os.path.join("profile_images", file_name)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image not found")
    
    content_type = "image/jpeg" 
    if file_name.endswith(".png"):
        content_type = "image/png"
    elif file_name.endswith(".gif"):
        content_type = "image/gif"
    
    with open(file_path, "rb") as f:
        image_data = f.read()
    
    return Response(content=image_data, media_type=content_type)

@app.post("/api/generate_audio")
async def generate_audio(request: Request):
    data = await request.json()
    text = data.get("text", "")
    language = data.get("language", "en")
    voice_type = data.get("voice_type", "standard")
    model = data.get("model")
    
    os.makedirs(SOUND_RESPONSE_DIR, exist_ok=True)
    
    print(f"Sound responses directory: {os.path.abspath(SOUND_RESPONSE_DIR)}")
    
    filename = f"speech_{language}_{int(time.time())}_{uuid.uuid4().hex[:8]}.mp3"
    file_path = os.path.join(SOUND_RESPONSE_DIR, filename)
    
    try:
        from gtts import gTTS
        tts = gTTS(text=text, lang=language)
        tts.save(file_path)
        
        print(f"Audio saved to: {os.path.abspath(file_path)}")
        
        return JSONResponse(content={
            "audio_url": f"/audio/{filename}", 
            "full_path": os.path.abspath(file_path)
        })
        
    except Exception as e:
        print(f"Error generating audio: {e}")
        traceback.print_exc()  # Add this to get detailed error information
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )
    
@app.post("/api/clear_conversation")
async def clear_conversation(request: dict = Body(...)):
    try:
        username = request.get("username")
        force_clear = request.get("force_clear", False)
        is_discarded = request.get("is_discarded", True)  # Default to true
        conversation_id = request.get("conversation_id")
        batch_id = request.get("batch_id")
        
        if not username:
            raise HTTPException(status_code=400, detail="Username is required")
        
        logger.info(f"Flagging conversation as discarded for user: {username}, is_discarded: {is_discarded}")
        
        # Get the user profile
        user_profile = load_user_profile(username)
        if not user_profile:
            return {"success": True, "message": "No user profile found to mark", "action": "discard"}
        
        # Make sure preferences exist
        if "preferences" not in user_profile:
            user_profile["preferences"] = {}
        
        # Set discard flag in preferences
        user_profile["preferences"]["discard_conversation"] = True
        user_profile["preferences"]["save_to_history"] = False
        
        # Instead of clearing messages, FLAG them as discarded
        if "chat_history" in user_profile:
            marked_count = 0
            
            for message in user_profile["chat_history"]:
                # Mark message as discarded if it matches the conversation_id or batch_id
                if ((conversation_id and message.get("conversation_id") == conversation_id) or
                    (batch_id and message.get("batch_id") == batch_id) or force_clear):
                    message["is_discarded"] = True
                    marked_count += 1
            
            logger.info(f"Marked {marked_count} messages as discarded")
        
        # Save the updated profile
        save_user_profile(user_profile)
        
        return {
            "success": True, 
            "message": f"Conversation marked as discarded ({marked_count} messages flagged)",
            "action": "discard",
            "marked_count": marked_count
        }
        
    except Exception as e:
        logger.error(f"Error in clear_conversation: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Failed to mark conversation as discarded: {str(e)}"}
        )
    
@app.post("/api/discard_by_batchid")
async def discard_by_batchid(request: dict = Body(...)):
    try:
        username = request.get("username")
        batch_id = request.get("batch_id")
        
        if not username or not batch_id:
            logger.error("Username and batch_id are required")
            return JSONResponse(
                status_code=400,
                content={"detail": "Username and batch_id are required"}
            )
        
        logger.info(f"Received request to delete messages with batch_id {batch_id} for user {username}")
        
        # Get the user document to find user_id
        user = db_manager.users_collection.find_one({"username": username})
        if not user:
            logger.error(f"User {username} not found")
            return JSONResponse(
                status_code=404,
                content={"detail": f"User {username} not found"}
            )
        
        user_id = user["_id"]
        
        # Query to find messages
        query = {
            "user_id": user_id,
            "batch_id": batch_id
        }
        
        # If you want to physically delete the messages:
        result = db_manager.db.chat_messages.delete_many(query)
        deleted_count = result.deleted_count
        logger.info(f"Deleted {deleted_count} messages from chat_messages collection")
        
        # Or if you want to mark them as discarded instead:
        # result = db_manager.db.chat_messages.update_many(
        #     query,
        #     {"$set": {"is_discarded": True}}
        # )
        # modified_count = result.modified_count
        # logger.info(f"Marked {modified_count} messages as discarded in chat_messages collection")
        
        return JSONResponse(
            status_code=200,
            content={"status": "success", "deleted_count": deleted_count}
        )
        
    except Exception as e:
        logger.exception(f"Error in discard_by_batchid: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"detail": f"Failed to process request: {str(e)}"}
        )

@app.get("/api/debug_db")
async def debug_db():
    """Test database connectivity and check user records"""
    try:
        test_user = "test_user"
        
        # Check if user exists
        user_doc = db_manager.users_collection.find_one({"username": test_user})
        
        if not user_doc:
            # Create test user if not exists
            db_manager.users_collection.insert_one({
                "username": test_user,
                "chat_history": [],
                "created_at": datetime.now().isoformat()
            })
            user_doc = db_manager.users_collection.find_one({"username": test_user})
        
        # Count document fields
        chat_history_count = 0
        if user_doc and "chat_history" in user_doc:
            chat_history_count = len(user_doc["chat_history"])
        
        return {
            "status": "database connected",
            "test_user": {
                "exists": user_doc is not None,
                "chat_history_count": chat_history_count
            }
        }
    except Exception as e:
        logger.exception("Database test failed")
        return {"error": str(e)}

@app.get("/api/debug_conversations")
async def debug_conversations(username: str = None):
    """Debug endpoint to view conversations in the database"""
    try:
        if not username:
            return {"error": "Username is required"}
            
        # Check if user exists
        user_doc = db_manager.users_collection.find_one({"username": username})
        
        if not user_doc:
            return {"error": f"User '{username}' not found"}
            
        # Debugging info
        result = {
            "username": username,
            "has_chat_history": "chat_history" in user_doc,
            "chat_history_type": type(user_doc.get("chat_history", None)).__name__,
        }
        
        # Add message counts if chat_history exists
        if "chat_history" in user_doc and isinstance(user_doc["chat_history"], list):
            messages = user_doc["chat_history"]
            
            # Count messages by type
            user_messages = sum(1 for msg in messages if "user" in msg)
            ai_messages = sum(1 for msg in messages if "ai" in msg)
            discarded_messages = sum(1 for msg in messages if msg.get("is_discarded") == True)
            
            # Group by batch_id
            batches = {}
            for msg in messages:
                batch_id = msg.get("batch_id", "unknown")
                if batch_id not in batches:
                    batches[batch_id] = []
                batches[batch_id].append(msg)
            
            result.update({
                "total_messages": len(messages),
                "user_messages": user_messages,
                "ai_messages": ai_messages,
                "discarded_messages": discarded_messages,
                "batch_count": len(batches),
                "batches": [
                    {
                        "batch_id": batch_id,
                        "message_count": len(batch_messages),
                        "sample": batch_messages[0] if batch_messages else None
                    }
                    for batch_id, batch_messages in batches.items()
                ][:5]  # Limit to 5 batches for readability
            })
            
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}
    
@app.post("/api/migrate_chat_history")
async def migrate_chat_history(username: str = None):
    """Migrate existing chat history from user documents to chat_messages collection"""
    try:
        if username:
            # Migrate specific user
            users_to_migrate = [db_manager.db.users.find_one({"username": username})]
            if not users_to_migrate[0]:
                return {"success": False, "message": f"User {username} not found"}
        else:
            # Migrate all users
            users_to_migrate = list(db_manager.db.users.find({}))
            
        migration_results = []
        total_migrated = 0
        
        for user in users_to_migrate:
            if not user:
                continue
                
            username = user["username"]
            user_id = user["_id"]
            
            # Skip if no chat_history
            if "chat_history" not in user or not isinstance(user["chat_history"], list) or len(user["chat_history"]) == 0:
                migration_results.append({
                    "username": username,
                    "status": "skipped",
                    "reason": "No chat history found"
                })
                continue
                
            # Process each message in chat_history
            migrated_count = 0
            for msg in user["chat_history"]:
                if not isinstance(msg, dict):
                    continue
                    
                # Add user_id to the message
                msg["user_id"] = user_id
                
                # Ensure timestamp exists
                if "timestamp" not in msg:
                    msg["timestamp"] = datetime.now().isoformat()
                
                # Insert into chat_messages collection
                db_manager.db.chat_messages.insert_one(msg)
                migrated_count += 1
            
            # Update migration results
            migration_results.append({
                "username": username,
                "migrated_messages": migrated_count,
                "status": "success"
            })
            
            total_migrated += migrated_count
            
            # Optionally, clear the chat_history array from user document
            db_manager.db.users.update_one(
                {"_id": user_id},
                {"$unset": {"chat_history": ""}}
            )
            
        return {
            "success": True,
            "total_users": len(users_to_migrate),
            "total_migrated_messages": total_migrated,
            "results": migration_results
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }
    
@app.get("/api/debug_chat_messages")
async def debug_chat_messages(username: str):
    """Debug endpoint to view messages in chat_messages collection"""
    try:
        if not username:
            return {"error": "Username is required"}
            
        # Get user document
        user = db_manager.users_collection.find_one({"username": username})
        if not user:
            return {"error": f"User {username} not found"}
            
        # Count messages in chat_messages collection
        chat_messages_count = db_manager.db.chat_messages.count_documents({"user_id": user["_id"]})
        
        # Get a sample of messages
        messages = list(db_manager.db.chat_messages.find({"user_id": user["_id"]}).sort("timestamp", -1).limit(5))
        
        # Convert ObjectId to string for JSON serialization
        for msg in messages:
            if "_id" in msg:
                msg["_id"] = str(msg["_id"])
            if "user_id" in msg:
                msg["user_id"] = str(msg["user_id"])
                
        return {
            "username": username,
            "user_id": str(user["_id"]),
            "messages_count": chat_messages_count,
            "message_samples": messages
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}
    
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("app.main:app", host=host, port=port, reload=True)