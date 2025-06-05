import re
import emoji
import os
import json
# import time
# import tempfile
# import queue
# import sys
from pdb import set_trace as breakpoint
from gtts import gTTS
from prompts import PROFILE_DIR, DEFAULT_SCENARIOS, SOUND_RESPONSE_DIR
# import sounddevice as sd
# import soundfile as sf
# from pynput.keyboard import Key, Listener
import speech_recognition as sr
from deep_translator import GoogleTranslator
# import wavio as wv
# import numpy as np

freq = 41400
channels = 1

#Record Functions
# def record_continue():
#     #Setup Keyboard
#     recording = False
#     def on_press(key):
#         nonlocal recording
#         if key == Key.shift:
#             recording = True
        
    
#     def on_release(key):
#         nonlocal recording
#         if key == Key.shift:
#             recording = False
#     listener =Listener(on_press = on_press, on_release = on_release)
#     listener.start()

#     #Setup Audio
#     q = queue.Queue()
#     #Variables
#     freq = 48000
#     channels = 1
    
#     def callback(indata, frames, time, status):
#         """This is called (from a separate thread) for each audio block."""
#         if status:
#             print(status, file=sys.stderr)
#         q.put(indata.copy())

#     print("Hold shift to record. Release to end")
#     while not recording:
#         time.sleep(0.1)
#     print("Recording now!")
#     # Make sure the file is opened before recording anything:
#     with sf.SoundFile('record.wav', mode='w', samplerate=freq, channels=1) as file: #mode 'w' truncates file
#         with sd.InputStream(samplerate=freq, channels=1, callback=callback):
#             print('#' * 80)
#             print('Release shift to stop the recording')
#             print('#' * 80)
#             while recording:
#                 file.write(q.get())
#         file.close()

#Note, original_lang and translate_lang follow ISO tags
def transcribe(original_lang, translate_lang):
    recognizer = sr.Recognizer()

    # Create audio file instance from the original file
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
    return text, translated #Returns both the transcribed text and the translated text

def clean_text(text):
    text = re.sub(r'\*.*?\*', '', text)
    text = emoji.replace_emoji(text, replace='')
    text = ' '.join(text.split())
    return text

def load_user_profile(username):
    profile_path = os.path.join(PROFILE_DIR, f"{username}.json")
    if os.path.exists(profile_path):
        with open(profile_path, "r") as file:
            user_profile = json.load(file)
    else:
        user_profile = {"username": username, "scenario": None, "chat_history": [], "lesson": []}

    if "ai_role" not in user_profile:
        user_profile["ai_role"] = None

    return user_profile


def save_user_profile(user_profile):
    profile_path = os.path.join(PROFILE_DIR, f"{user_profile['username']}.json")
    with open(profile_path, "w") as file:
        json.dump(user_profile, file, indent=4)
    # os.makedirs(f"{SOUND_RESPONSE_DIR}_{user_profile['username']}", exist_ok=True)
    


def infer_ai_role(scenario_description, llm): # returns suggestions
    content = f"Based on the following scenario, what role should the AI play?\n\nScenario: {scenario_description}\n\nAI Role:"
    # print("what " + scenario_description + " the hell")
    formatted_prompt = [{"role": "user", "content": content}]
    response = llm(
        formatted_prompt,
        do_sample=False, 
        max_new_tokens=100,
    )[0]['generated_text'][1]["content"]
    print(response)
    #print("AI ROLE RESPONSE")
    #print(response)
    return response if response else "assistant" 

def get_lesson(username, llm):
    # Get llm
    
    user_profile = load_user_profile(username)
    
    #No chat history or not enogh chat history
    if not user_profile.get("chat_history") or len(user_profile["chat_history"]) < 3:
        return {
            "critique": "You need more conversation to receive meaningful feedback.",
            "lessons": [
                "Try to engage in longer conversations for better language practice.",
                "Use a variety of sentence structures in your responses.",
                "Practice asking questions to keep the conversation flowing."
            ]
        }
    
    # Build formatted history
    formatted_history = ""
    for entry in user_profile["chat_history"][-10:]:  # Use last 10 entries
        if entry["user"] != "AI INITIATED":
            formatted_history += f"User: {entry['user']}\n"
        formatted_history += f"You: {entry['ai']}\n"
    # Create prompt for lesson
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
    
    # Save lesson prompt to user profile
    if "lesson" not in user_profile:
        user_profile["lesson"] = []
    user_profile["lesson"].append(formatted_prompt)
    save_user_profile(user_profile)
    
    # Generate lesson
    lesson_text = llm(
        formatted_prompt,
        do_sample=True,
        top_k=50,
        top_p=0.7,
        num_return_sequences=1,
        repetition_penalty=1.1,
        max_new_tokens=1024,
    )[0]['generated_text'].split('Post your response here:')[-1].strip()
    # print("ORIGINAL LESSON RESPONSE")
    # print(lesson_text)
    # Extract critique and lessons
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

    # if "Critique:" in lesson_text:
    #     parts = lesson_text.split("Critique:")
    #     critique_and_lessons = parts[1]
    #     if "Grammar Lessons:" in critique_and_lessons:
    #         critique_part, lessons_part = critique_and_lessons.split("Grammar Lessons:")
    #         critique = critique_part.strip()
            
    #         # Extract lessons
    #         lesson_lines = []
    #         for line in lessons_part.strip().split('\n'):
    #             line = line.strip()
    #             if line and (line.startswith("1.") or line.startswith("2.") or line.startswith("3.") or line.startswith("-")):
    #                 for prefix in ["1.", "2.", "3.", "-"]:
    #                     if line.startswith(prefix):
    #                         lesson = line[len(prefix):].strip()
    #                         lesson_lines.append(lesson)
    #         lessons = lesson_lines
    
    # Fallbacks
    if not critique:
        critique = "You're making good progress in your conversation skills!"
    # print(critique)
    # print(lessons)
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
                        break #Possible source of error?
    
    return {
        "critique": critique,
        "lessons": lessons[:3]  # Return top 3 lessons
    }

def get_suggestions(username, llm):
    user_profile = load_user_profile(username)
    
    if not user_profile.get("chat_history") or len(user_profile["chat_history"]) == 0:
        return {"suggestions": ["Hello, how are you?", "Nice to meet you!", "What would you like to talk about?"]}
    
    # Build formatted history for the last few exchanges
    formatted_history = ""
    recent_history = user_profile["chat_history"][-5:] if len(user_profile["chat_history"]) > 5 else user_profile["chat_history"]
    for entry in recent_history:
        if entry["user"] != "AI INITIATED":
            formatted_history += f"User: {entry['user']}\n"
        formatted_history += f"You: {entry['ai']}\n"
    # Create prompt for suggestions
    formatted_prompt = f"""
    You are playing the role of {user_profile['ai_role']} in the following scenario: {user_profile['scenario']}
    The chat history is as followed: {formatted_history}
    The user is in an ongoing conversation and needs help continuing it naturally.
    Given the last ai response, generate three possible ways the user could reply next.
    Each response should be a complete sentence that the user might actually say in the conversation.
    Do NOT provide conversation suggestions—only full user replies. 
    Format your response as follows:
    
    Suggestions:
    1. [Suggestion 1]
    2. [Suggestion 2]
    3. [Suggestion 3]

    Post your response here:"""
    
    # Generate suggestions
    suggestion_text = llm(
        formatted_prompt,
        do_sample=True,
        top_k=50,
        top_p=0.7,
        num_return_sequences=1,
        repetition_penalty=1.1,
        max_new_tokens=256,
    )[0]['generated_text'].split('Suggestions:')[-1].strip()
    #print(suggestion_text)
    # Parse suggestions
    suggestions = []
    for line in suggestion_text.split("\n"):
        line = line.strip()
        if line and (line.startswith("1.") or line.startswith("2.") or line.startswith("3.") or line.startswith("-")):
            for prefix in ["1.", "2.", "3.", "-", " "]:
                if line.startswith(prefix):
                    suggestion = line[len(prefix):].strip()
                    suggestions.append(suggestion)
                    break
    #print(suggestions)
    # Add fallbacks if needed
    while len(suggestions) < 3:
        fallbacks = [
            "I understand what you're saying.",
            "That's interesting. Can you tell me more?",
            "I agree with your perspective.",
            "What do you think about this?",
            "Could you explain that differently?"
        ]
        for fallback in fallbacks:
            if fallback not in suggestions:
                suggestions.append(fallback)
                if len(suggestions) >= 3:
                    break
    
    return {"suggestions": suggestions[:3]}
