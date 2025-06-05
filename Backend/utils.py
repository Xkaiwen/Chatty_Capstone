import re
import emoji
import os
import json
from pdb import set_trace as breakpoint
from gtts import gTTS
from prompts import DEFAULT_SCENARIOS, SOUND_RESPONSE_DIR, LANGUAGE_MAP
import speech_recognition as sr
from deep_translator import GoogleTranslator
from database.mongodb_manager import MongoDBManager
from datetime import datetime

db_manager = MongoDBManager()

freq = 41400
channels = 1

def transcribe(original_lang, translate_lang):
    recognizer = sr.Recognizer()

    try:
        audio_ex = sr.AudioFile('record.wav')
    except:
        print("No recording found")
        exit()
    # Create audio data
    with audio_ex as source:
        audiodata = recognizer.record(audio_ex) 
    # Extract text
    try:
        text = recognizer.recognize_google(audio_data=audiodata, language=original_lang)
    except:
        print("Error: Can't recognize")
        exit()

    translated = GoogleTranslator(source=original_lang, target=translate_lang).translate(text)
    return text, translated

def clean_text(text):
    text = re.sub(r'\*.*?\*', '', text)
    text = emoji.replace_emoji(text, replace='')
    text = ' '.join(text.split())
    return text

def load_user_profile(username):
    try:
        return db_manager.load_user_profile(username)
    except Exception as e:
        print(f"Error loading user profile: {e}")
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
        print(f"Error saving user profile: {e}")
        raise
    


def infer_ai_role(scenario_description, llm):
    content = f"Based on the following scenario, what role should the AI play?\n\nScenario: {scenario_description}\n\nAI Role:"
    formatted_prompt = [{"role": "user", "content": content}]
    response = llm(
        formatted_prompt,
        do_sample=False, 
        max_new_tokens=100,
    )[0]['generated_text'][1]["content"]
    return response if response else "assistant" 


def get_lesson(username, llm):
    
    user_profile = load_user_profile(username)
    
    if not user_profile.get("chat_history") or len(user_profile["chat_history"]) < 3:
        return {
            "critique": "You need more conversation to receive meaningful feedback.",
            "lessons": [
                "Try to engage in longer conversations for better language practice.",
                "Use a variety of sentence structures in your responses.",
                "Practice asking questions to keep the conversation flowing."
            ]
        }
    
    formatted_history = ""
    for entry in user_profile["chat_history"][-10:]: 
        if entry["user"] != "AI INITIATED":
            formatted_history += f"User: {entry['user']}\n"
        formatted_history += f"You: {entry['ai']}\n"
    formatted_prompt = f"""
    You are playing the role of a conversational partner in the following scenario: {user_profile['scenario']}.
    The chat history is as follows: {formatted_history}.            
    Provide three lessons for the user to improve their grammar. If there are mistakes, correct them and explain why.
    If there are no clear mistakes, focus on refining phrasing, improving fluency, or teaching a fun grammar-related lesson.
    Additionally, provide a one-sentence critique of the user's language use, highlighting both strengths and areas for improvement. Be kind and friendly in this critique.
    Whenever possible, provide examples from the conversation to support your critique and grammar lessons.
    Do NOT provide any other responses - only the grammar lessons and critique
    Format your response as follows:
    
    Grammar Lessons:
    1. [Grammar Lesson 1]
    2. [Grammar Lesson 2]
    3. [Grammar Lesson 3]

    Critique:
    [Critique]

    Post your response here:"""
    
    if "lesson" not in user_profile:
        user_profile["lesson"] = []
    user_profile["lesson"].append(formatted_prompt)
    save_user_profile(user_profile)
    
    lesson_text = llm(
        formatted_prompt,
        do_sample=True,
        top_k=50,
        top_p=0.7,
        num_return_sequences=1,
        repetition_penalty=1.1,
        max_new_tokens=1024,
    )[0]['generated_text'].split('Post your response here:')[-1].strip()
    critique = ""
    lessons = []
    
    # Parse response
    lessons_and_critique = lesson_text.split('Grammar Lessons:')[-1].split('Critique:')
    critique = lessons_and_critique[-1].strip()
    lessons = lessons_and_critique[0].strip()
    # Extract lessons
    lesson_lines = []
    for line in lessons.strip().split('\n'):
        line = line.strip()
        if line and (line.startswith("1.") or line.startswith("2.") or line.startswith("3.") or line.startswith("-")):
            for prefix in ["1.", "2.", "3.", "-"]:
                if line.startswith(prefix):
                    lesson = line[len(prefix):].strip()
                    lesson_lines.append(lesson)
    lessons = lesson_lines
    
    if not critique:
        critique = "You're making good progress in your conversation skills!"
    if not lessons or len(lessons) < 3:
        default_lessons = [
            "Try varying your sentence structure to make your speech more interesting.",
            "Practice using connecting words like 'however', 'therefore', and 'meanwhile' to link your ideas.",
            "Work on using more descriptive adjectives to make your statements more vivid."
        ]
        while len(lessons) < 3:
            for lesson in default_lessons:
                if lesson not in lessons:
                    lessons.append(lesson)
                    if len(lessons) >= 3:
                        break
    
    return {
        "critique": critique,
        "lessons": lessons[:3]
    }

def generate_suggestion(username, llm, requested_language=None):
    user_profile = load_user_profile(username)
    
    language = requested_language if requested_language else user_profile.get('language', 'en')
    
    normalized_language = normalize_language(language)
    print(f"Generating suggestions for {username} in language: {normalized_language} (original: {language})")
    
    if not user_profile.get("chat_history") or len(user_profile["chat_history"]) == 0:
        return get_default_suggestions(normalized_language)
    
    formatted_history = ""
    recent_history = user_profile["chat_history"][-5:] if len(user_profile["chat_history"]) > 5 else user_profile["chat_history"]
    for entry in recent_history:
        if "user" in entry and entry["user"] != "AI INITIATED":
            formatted_history += f"User: {entry['user']}\n"
        if "ai" in entry:
            formatted_history += f"You: {entry['ai']}\n"
    
    formatted_prompt = f"""
    You are playing the role of {user_profile.get('ai_role', 'a friendly conversation partner')} in the following scenario: {user_profile.get('scenario', 'a casual conversation')}
    The chat history is as follows: {formatted_history}
    The user is in an ongoing conversation and needs help continuing it naturally.
    Given the last AI response, generate THREE possible ways the user could reply to the previous AI-generated messages.
    
    IMPORTANT: You must generate all suggestions in {normalized_language} language ONLY.
    
    Each response should be a complete sentence that the user might actually say in the conversation.
    Your suggestions must be in {normalized_language} regardless of what language appears in the chat history.
    
    Do NOT provide conversation instructions—only full user replies that they could copy and use.
    
    Format your response as follows:
    Suggestions:
    1. [First suggestion in {normalized_language}]
    2. [Second suggestion in {normalized_language}]
    3. [Third suggestion in {normalized_language}]
    
    Post your response here:"""
    
    try:
        suggestion_text = llm(
            formatted_prompt,
            do_sample=True,
            top_k=50,
            top_p=0.7,
            num_return_sequences=1,
            repetition_penalty=1.1,
            max_new_tokens=256,
        )[0]['generated_text']
        
        suggestion_text = suggestion_text.split('Suggestions:')[-1].strip()
        
        suggestions = []
        for line in suggestion_text.split("\n"):
            line = line.strip()
            if line and (line.startswith("1.") or line.startswith("2.") or line.startswith("3.") or line.startswith("-")):
                for prefix in ["1.", "2.", "3.", "-", " "]:
                    if line.startswith(prefix):
                        if "[Suggestion" in line or "[First suggestion" in line or "[Second suggestion" in line or "[Third suggestion" in line:
                            continue
                        suggestion = line[len(prefix):].strip()
                        if suggestion and suggestion not in suggestions:
                            suggestions.append(suggestion)
                        break

        if not suggestions or any(("[" in s and "]" in s) for s in suggestions):
            for line in suggestion_text.split("\n"):
                line = line.strip()
                if line.startswith("User:"):
                    fallback_suggestion = line[len("User:"):].strip()
                    if fallback_suggestion:
                        suggestions.append(fallback_suggestion)
        
        if not suggestions or len(suggestions) < 3:
            fallbacks = get_fallback_suggestions(normalized_language)
            for fallback in fallbacks:
                if fallback not in suggestions:
                    suggestions.append(fallback)
                    if len(suggestions) >= 3:
                        break
        
        return {"suggestions": suggestions[:3]}
    
    except Exception as e:
        print(f"Error generating suggestions: {e}")
        return get_default_suggestions(normalized_language)
    

def normalize_language(language_code):
    """Normalize language code to a consistent format"""
    if not language_code:
        return 'en'
        
    language_code = str(language_code).lower().strip()
    
    language_mapping = {
        'english': 'en', 'en': 'en', 'en-us': 'en', 'en-gb': 'en',
        
        'chinese': 'zh-CN', 'chinese (simplified)': 'zh-CN', 'zh': 'zh-CN', 'zh-cn': 'zh-CN',
        'chinese (traditional)': 'zh-TW', 'zh-tw': 'zh-TW', 'traditional chinese': 'zh-TW',
        
        'japanese': 'ja', 'ja': 'ja', 'ja-jp': 'ja',
        
        'korean': 'ko', 'ko': 'ko', 'ko-kr': 'ko',
        
        'spanish': 'es', 'es': 'es', 'es-es': 'es', 'es-mx': 'es',
        
        'french': 'fr', 'fr': 'fr', 'fr-fr': 'fr',
        
        'german': 'de', 'de': 'de', 'de-de': 'de',
        
        'italian': 'it', 'it': 'it', 'it-it': 'it',
    }
    
    return language_mapping.get(language_code, language_code)

def get_default_suggestions(language_code):
    """Return default suggestions for new conversations in the specified language"""
    default_suggestions = {
        'en': [
            "Hello, how are you?", 
            "Nice to meet you!", 
            "What would you like to talk about?"
        ],
        'zh-cn': [
            "你好，你好吗？", 
            "很高兴认识你！", 
            "你想聊些什么？"
        ],
        'zh-tw': [
            "你好，你好嗎？", 
            "很高興認識你！", 
            "你想聊些什麼？"
        ],
        'ja': [
            "こんにちは、お元気ですか？", 
            "はじめまして！", 
            "何について話したいですか？"
        ],
        'ko': [
            "안녕하세요, 어떻게 지내세요?", 
            "만나서 반갑습니다!", 
            "무엇에 대해 이야기하고 싶으세요?"
        ],
        'es': [
            "¡Hola! ¿Cómo estás?", 
            "¡Encantado de conocerte!", 
            "¿De qué te gustaría hablar?"
        ],
        'fr': [
            "Bonjour ! Comment ça va ?", 
            "Ravi de faire votre connaissance !", 
            "De quoi voudrais-tu parler ?"
        ],
        'de': [
            "Hallo! Wie geht es dir?", 
            "Schön, dich kennenzulernen!", 
            "Worüber möchtest du sprechen?"
        ],
        'it': [
            "Ciao! Come stai?", 
            "Piacere di conoscerti!", 
            "Di cosa ti piacerebbe parlare?"
        ],
    }
    
    normalized_code = language_code.lower()
    if normalized_code in default_suggestions:
        return {"suggestions": default_suggestions[normalized_code]}
    else:
        return {"suggestions": default_suggestions['en']}


def get_fallback_suggestions(language_code):
    """Return fallback suggestions if LLM fails to generate good ones"""
    fallbacks = {
        'en': [
            "I understand what you're saying.",
            "That's interesting. Can you tell me more?",
            "I agree with your perspective.",
            "What do you think about this?",
            "Could you explain that differently?"
        ],
        'zh-cn': [
            "我理解你的意思。",
            "真有意思，能告诉我更多吗？",
            "我同意你的观点。",
            "你对此有什么看法？",
            "你能用不同方式解释一下吗？"
        ],
        'zh-tw': [
            "我理解你的意思。",
            "真有意思，能告訴我更多嗎？",
            "我同意你的觀點。",
            "你對此有什麼看法？",
            "你能用不同方式解釋一下嗎？"
        ],
        'ja': [
            "あなたの言っていることは理解できます。",
            "それは面白いですね。もっと教えてください。",
            "あなたの視点に同意します。",
            "これについてどう思いますか？",
            "別の方法で説明していただけますか？"
        ],
        'ko': [
            "당신이 말하는 것을 이해합니다.",
            "흥미롭네요. 더 자세히 알려주시겠어요?",
            "당신의 관점에 동의합니다.",
            "이것에 대해 어떻게 생각하세요?",
            "다른 방식으로 설명해 주시겠어요?"
        ],
        'es': [
            "Entiendo lo que estás diciendo.",
            "Eso es interesante. ¿Puedes contarme más?",
            "Estoy de acuerdo con tu perspectiva.",
            "¿Qué piensas sobre esto?",
            "¿Podrías explicarlo de otra manera?"
        ],
        'fr': [
            "Je comprends ce que tu dis.",
            "C'est intéressant. Peux-tu m'en dire plus ?",
            "Je suis d'accord avec ton point de vue.",
            "Qu'en penses-tu ?",
            "Pourrais-tu l'expliquer différemment ?"
        ],
        'de': [
            "Ich verstehe, was du sagst.",
            "Das ist interessant. Kannst du mir mehr darüber erzählen?",
            "Ich stimme deiner Perspektive zu.",
            "Was denkst du darüber?",
            "Könntest du das anders erklären?"
        ],
        'it': [
            "Capisco quello che stai dicendo.",
            "È interessante. Puoi dirmi di più?",
            "Sono d'accordo con la tua prospettiva.",
            "Cosa ne pensi di questo?",
            "Potresti spiegarlo in modo diverso?"
        ],
    }
    
    normalized_code = language_code.lower()
    return fallbacks.get(normalized_code, fallbacks['en'])
