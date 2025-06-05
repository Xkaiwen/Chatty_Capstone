from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import os
import sys

# Add the parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
# Update the import to use utilsEdit instead of utils, and include get_suggestions
from utilsEdit import load_user_profile, get_suggestions

# Get OpenAI client from main
from app.main import client

router = APIRouter(
    prefix="/api",
    tags=["suggestions"],
)

class SuggestionRequest(BaseModel):
    username: str

class SuggestionResponse(BaseModel):
    suggestions: List[str]

@router.post("/suggestions", response_model=SuggestionResponse)
async def get_suggestions_endpoint(request: SuggestionRequest):
    username = request.username
    
    # Call the get_suggestions function from utilsEdit, passing the client instead of llm
    return get_suggestions(username, client)