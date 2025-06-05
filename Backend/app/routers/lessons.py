'''from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import os
import sys

# Add the parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from utils import load_user_profile, save_user_profile

# Get llm from main
from app.main import init_llm

router = APIRouter(
    prefix="/api",
    tags=["lessons"],
)

class LessonRequest(BaseModel):
    username: str

class LessonResponse(BaseModel):
    critique: str
    lessons: List[str]

@router.post("/lesson", response_model=LessonResponse)
async def get_lesson(request: LessonRequest):
    # Get llm
    llm = init_llm()
    
    username = request.username
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
    
    # Build formatted history
    formatted_history = ""
    for entry in user_profile["chat_history"][-10:]:  # Use last 10 entries
        if entry["user"] != "AI INITIATED":
            formatted_history += f"User: {entry['user']}\n"
        formatted_history += f"You: {entry['ai']}\n"
    
    # Create prompt for lesson
    formatted_prompt = f"""
    <s>[INST] <<SYS>>
    You are playing the role of {user_profile['ai_role']} in the following scenario: {user_profile['scenario']}.
    The chat history is as follows: {formatted_history}.            
    Based on the conversation, provide three grammar-related lessons or points of improvement for the user. If there are mistakes, correct them and explain why. If there are no clear mistakes, focus on refining phrasing, improving fluency, or teaching a fun grammar-related lesson.
    Additionally, provide a brief and kind critique of the user's language use, highlighting both strengths and areas for improvement.
    Format your response as follows:
    
    Critique: [Brief, kind feedback]
    
    Grammar Lessons:
    1. [Lesson 1]
    2. [Lesson 2]
    3. [Lesson 3]

    Post your response here:
    <</SYS>>
    [/INST]"""
    
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
    )[0]['generated_text'].split('[/INST]')[-1].strip()
    
    # Extract critique and lessons
    critique = ""
    lessons = []
    
    # Parse response
    if "Critique:" in lesson_text:
        parts = lesson_text.split("Critique:")
        critique_and_lessons = parts[1]
        if "Grammar Lessons:" in critique_and_lessons:
            critique_part, lessons_part = critique_and_lessons.split("Grammar Lessons:")
            critique = critique_part.strip()
            
            # Extract lessons
            lesson_lines = []
            for line in lessons_part.strip().split('\n'):
                line = line.strip()
                if line and (line.startswith("1.") or line.startswith("2.") or line.startswith("3.") or line.startswith("-")):
                    for prefix in ["1.", "2.", "3.", "-"]:
                        if line.startswith(prefix):
                            lesson = line[len(prefix):].strip()
                            lesson_lines.append(lesson)
            lessons = lesson_lines
    
    # Fallbacks
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
        "lessons": lessons[:3]  # Return top 3 lessons
    }'''
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import os
import sys

# Add the parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from utilsEdit import load_user_profile, get_lesson  # Changed from utils to utilsEdit
from prompts import DEFAULT_SCENARIOS

# Get OpenAI client from main instead of llm
from app.main import client

router = APIRouter(
    prefix="/api",
    tags=["lessons"],
)

class LessonRequest(BaseModel):
    username: str

class LessonResponse(BaseModel):
    critique: str
    lessons: List[str]

@router.post("/lessons", response_model=LessonResponse)
async def get_lessons_endpoint(request: LessonRequest):
    username = request.username
    
    # Call get_lesson function from utilsEdit, passing client instead of llm
    return get_lesson(username, client)