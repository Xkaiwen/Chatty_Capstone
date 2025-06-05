import os
import json
from datetime import datetime
from pymongo import MongoClient
from dotenv import load_dotenv
from bson import ObjectId
from datetime import datetime
import uuid
import traceback

load_dotenv()

class MongoDBManager:

    def __init__(self, db=None):
        try:
            if db:
                self.db = db
                if hasattr(db, 'client'):
                    self.client = db.client
                else:
                    # Just for logging
                    print("Using provided db without direct client reference")
            else:
                # Get connection string from environment or use default
                self.uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
                self.db_name = os.getenv("MONGODB_DB", "language_assistant_db")
                
                print(f"Connecting to MongoDB: {self.uri}")
                self.client = MongoClient(self.uri)
                self.db = self.client[self.db_name]
                
            # Setup collection references
            self.users_collection = self.db.users
            
            # Initialize indexes
            self._create_indexes()
            
            print("MongoDB manager initialized successfully")
        except Exception as e:
            print(f"Error initializing MongoDB manager: {e}")
            traceback.print_exc()
            raise
    
    def _create_indexes(self):
        try:
            self.db.users.create_index("username", unique=True)
            
            self.db.chat_messages.create_index([("user_id", 1), ("timestamp", 1)])
            self.db.chat_messages.create_index([("batch_id", 1)])
            self.db.chat_messages.create_index([("is_discarded", 1)])
            
        except Exception as e:
            print(f"Error creating indexes: {e}")
    
    def load_user_profile(self, username):
        try:
            user = self.users_collection.find_one({"username": username})
            
            if not user:
                print(f"User {username} not found, creating a new profile")
                user_profile = {
                    "username": username,
                    "ai_role": "AI assistant",
                    "language": "English",
                    "locale": "en",
                    "scenario": "en",
                    "created_at": datetime.now().isoformat(),
                    "custom_scenarios": [],
                    "lessons": []
                }
                self.save_user_profile(user_profile)
                return user_profile
            
            # Get messages from chat_messages collection
            chat_history = []
            
            try:
                # Query messages from chat_messages collection
                cursor = self.db.chat_messages.find({"user_id": user["_id"]}).sort("timestamp", 1)
                
                messages = list(cursor)
                print(f"Raw chat history contains {len(messages)} total messages")
                
                # Process messages
                i = 0
                while i < len(messages):
                    message = messages[i]
                    
                    # Skip discarded messages unless specifically requested
                    if message.get("is_discarded", False):
                        i += 1
                        continue
                    
                    # Add message to chat history
                    message_dict = {}
                    
                    # Remove MongoDB-specific fields
                    if "_id" in message:
                        message["id"] = str(message["_id"])
                        del message["_id"]
                    
                    # Remove user_id since it's redundant in the user profile context
                    if "user_id" in message:
                        del message["user_id"]
                    
                    chat_history.append(message)
                    i += 1
                    
            except Exception as e:
                print(f"Error loading chat messages: {e}")
                import traceback
                traceback.print_exc()
            
            # Get custom scenarios
            custom_scenarios = []
            try:
                cursor = self.db.custom_scenarios.find({"user_id": user["_id"]})
                
                for scenario in list(cursor):
                    formatted_scenario = {
                        "id": str(scenario.get("_id")),
                        "title": scenario.get("title"),
                        "description": scenario.get("description"),
                        "created_at": scenario.get("created_at")
                    }
                    custom_scenarios.append(formatted_scenario)
            except Exception as e:
                print(f"Error loading custom scenarios: {e}")
            
            # Build the user profile
            user_profile = {
                "username": user["username"],
                "ai_role": user.get("ai_role", "AI assistant"),
                "language": user.get("language", "English"),
                "locale": user.get("locale", "en"),
                "scenario": user.get("scenario", "en"),
                "created_at": user.get("created_at"),
                "chat_history": chat_history,
                "custom_scenarios": custom_scenarios,
                "lessons": user.get("lessons", [])
            }
            
            return user_profile
            
        except Exception as e:
            print(f"Error loading user profile: {e}")
            import traceback
            traceback.print_exc()
            raise

    def append_chat_history(self, username, conversation_data, is_discarded=False):
        try:
            # Make sure all messages have proper batch_id and is_discarded flags
            batch_id = None
            for message in conversation_data:
                # Get batch_id from first message or generate one
                if not batch_id and 'batch_id' in message:
                    batch_id = message['batch_id']
                
                # If still no batch_id, generate one
                if not batch_id:
                    batch_id = f"batch-{datetime.now().strftime('%Y%m%d%H%M%S')}-{str(uuid.uuid4())[:8]}"
                
                # Set batch_id on all messages in this conversation
                message['batch_id'] = batch_id
                message['is_discarded'] = is_discarded
            
            # Get user profile or create new one if it doesn't exist
            user_profile = self.load_user_profile(username)
            if not user_profile:
                user_profile = {
                    "username": username,
                    "chat_history": [],
                    "created_at": datetime.now().isoformat()
                }
            
            # If chat_history doesn't exist or isn't a list, initialize it
            if not user_profile.get('chat_history') or not isinstance(user_profile['chat_history'], list):
                user_profile['chat_history'] = []
            
            # Append new messages
            user_profile['chat_history'].extend(conversation_data)
            
            # Update the document
            self.users_collection.update_one(
                {"username": username},
                {"$set": user_profile},
                upsert=True
            )
            
            return True
        except Exception as e:
            print(f"Error appending chat history for {username}: {e}")
            return False
    
    def save_conversation(self, username: str, conversation: list, is_discarded: bool = False, batch_id: str = None) -> bool:
        """Save conversation messages to the database for a user"""
        from datetime import datetime
        import traceback
        
        try:
            if not conversation or len(conversation) == 0:
                print(f"Warning: Empty conversation array for user {username}")
                return True  # Return success as there's nothing to save
                
            print(f"MongoDB: Saving {len(conversation)} messages for user {username}, batch_id={batch_id}, is_discarded={is_discarded}")
            
            # Debug: Print the first message
            if conversation and len(conversation) > 0:
                print(f"First message sample: {conversation[0]}")
            
            # First, ensure we have a batch_id
            if not batch_id:
                # Try to get from the first message
                if conversation and len(conversation) > 0 and isinstance(conversation[0], dict):
                    batch_id = conversation[0].get('batch_id')
                
                # If still no batch_id, create one
                if not batch_id:
                    import uuid
                    batch_id = f"batch-{datetime.now().strftime('%Y%m%d%H%M%S')}-{str(uuid.uuid4())[:8]}"
                    print(f"Generated new batch_id: {batch_id}")
            
            # Find or create user document to get the user_id
            user = self.users_collection.find_one({"username": username})
            
            if not user:
                # Create new user if not exists
                print(f"Creating new user document for {username}")
                user_result = self.users_collection.insert_one({
                    "username": username,
                    "created_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat()
                })
                user_id = user_result.inserted_id
            else:
                user_id = user["_id"]
            
            # Update each message and save to chat_messages collection
            inserted_count = 0
            for msg in conversation:
                if isinstance(msg, dict):
                    # Update message properties
                    msg['batch_id'] = batch_id
                    msg['is_discarded'] = is_discarded
                    msg['user_id'] = user_id  # Add user_id reference
                    
                    # Ensure timestamp exists
                    if 'timestamp' not in msg or not msg['timestamp']:
                        msg['timestamp'] = datetime.now().isoformat()
                    
                    # Insert into chat_messages collection
                    self.db.chat_messages.insert_one(msg)
                    inserted_count += 1
            
            print(f"MongoDB: Successfully inserted {inserted_count} messages into chat_messages collection")
            
            # Always update the timestamp on the user document
            self.users_collection.update_one(
                {"_id": user_id},
                {"$set": {"updated_at": datetime.now().isoformat()}}
            )
            
            return True
                
        except Exception as e:
            print(f"Error saving conversation: {str(e)}")
            traceback.print_exc()
            return False
        
    def save_user_profile(self, user_profile):
        try:
            if not user_profile or not isinstance(user_profile, dict):
                print("Invalid user profile data")
                return False
                
            username = user_profile.get("username")
            if not username:
                print("Username is required in user profile")
                return False
            
            # Add timestamp
            user_profile["updated_at"] = datetime.now().isoformat()
            
            # Ensure all messages in chat_history have is_discarded flag
            if 'chat_history' in user_profile and isinstance(user_profile['chat_history'], list):
                for msg in user_profile['chat_history']:
                    if isinstance(msg, dict) and 'is_discarded' not in msg:
                        msg['is_discarded'] = False
            
            # Update the document or insert if it doesn't exist
            result = self.users_collection.update_one(
                {"username": username},
                {"$set": user_profile},
                upsert=True
            )
            
            print(f"Save user profile result - matched: {result.matched_count}, modified: {result.modified_count}, upserted: {result.upserted_id is not None}")
            
            return True
        except Exception as e:
            print(f"Error saving user profile: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_user_profile(self, username):
        try:
            user = self.db.users.find_one({"username": username})
            if not user:
                print(f"User {username} not found")
                return False
            
            user_id = user["_id"]
            
            self.db.chat_messages.delete_many({"user_id": user_id})
            
            self.db.custom_scenarios.delete_many({"user_id": user_id})
            
            self.db.users.delete_one({"_id": user_id})
            
            print(f"User {username} and all associated data deleted")
            return True
            
        except Exception as e:
            print(f"Error deleting user profile: {e}")
            raise
    
    def add_custom_scenario(self, username, scenario):
        try:
            user = self.db.users.find_one({"username": username})
            if not user:
                print(f"User {username} not found")
                return False
            
            scenario_data = {
                "user_id": user["_id"],
                "id": scenario.get("id"),
                "title": scenario.get("title"),
                "description": scenario.get("description"),
                "role": scenario.get("role"),
                "created_at": scenario.get("created_at", datetime.now().isoformat())
            }
            
            self.db.custom_scenarios.insert_one(scenario_data)
            return True
            
        except Exception as e:
            print(f"Error adding custom scenario: {e}")
            raise
    
    async def insert_scenario_conversation(self, username, scenario_title, is_custom=False, language="en", created_at=None):
        """
        Insert a new scenario conversation record and return the conversation ID
        """
        if created_at is None:
            from datetime import datetime
            created_at = datetime.now().isoformat()
        
        conversation_doc = {
            "username": username,
            "scenario_title": scenario_title,
            "is_custom": is_custom,
            "language": language,
            "created_at": created_at
        }
        
        result = self.db["scenario_conversations"].insert_one(conversation_doc)
        conversation_id = str(result.inserted_id)
        
        print(f"Created scenario conversation with ID: {conversation_id}")
        return conversation_id

    async def insert_scenario_message(self, conversation_id, text, sender, audio_url=None, timestamp=None):
        """
        Insert a message related to a scenario conversation
        """
        if timestamp is None:
            from datetime import datetime
            timestamp = datetime.now().isoformat()
        
        message_doc = {
            "conversation_id": conversation_id,
            "text": text,
            "sender": sender,
            "audio_url": audio_url,
            "timestamp": timestamp
        }
        
        result = self.db["scenario_messages"].insert_one(message_doc)
        message_id = str(result.inserted_id)
        
        print(f"Added message {message_id} to conversation {conversation_id}")
        return message_id
    
    def close(self):
        """Close database connection"""
        if self.client:
            self.client.close()