from pymongo import MongoClient
from datetime import datetime
import os
import logging
import uuid

logger = logging.getLogger(__name__)

def init_mongodb():
    """Initialize MongoDB connection and create necessary collections"""
    try:
        # Get connection string from environment or use default
        mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
        db_name = os.getenv("MONGODB_DB", "language_assistant_db")
        
        # Connect to MongoDB
        client = MongoClient(mongo_uri)
        db = client[db_name]
        
        # Create indexes on common lookup fields
        try:
            db.users.create_index("username", unique=True)
            db.chat_messages.create_index([("user_id", 1), ("timestamp", 1)])
            logger.info("MongoDB indexes created successfully")
        except Exception as e:
            logger.warning(f"Error creating MongoDB indexes: {e}")
        
        # Verify connection
        client.admin.command('ping')
        logger.info(f"MongoDB initialized successfully: {mongo_uri}, db: {db_name}")
        
        return db
    except Exception as e:
        logger.error(f"Failed to initialize MongoDB: {e}")
        raise

if __name__ == "__main__":
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    # Initialize database
    db = init_mongodb()
    
    # Add a test user if none exists
    if db.users.count_documents({}) == 0:
        db.users.insert_one({
            "username": "test_user",
            "email": "test@example.com",
            "created_at": datetime.now().isoformat(),
            "chat_history": []
        })
        logger.info("Created test user")