import os
import json
from database.mongodb_manager import MongoDBManager
from prompts import PROFILE_DIR

def migrate_profiles():
    db_manager = MongoDBManager()
    
    json_files = [f for f in os.listdir(PROFILE_DIR) if f.endswith('.json')]
    
    print(f"Found {len(json_files)} profiles to migrate")
    
    success_count = 0
    error_count = 0
    
    for json_file in json_files:
        try:
            # Load JSON file
            file_path = os.path.join(PROFILE_DIR, json_file)
            with open(file_path, 'r', encoding='utf-8') as f:
                user_profile = json.load(f)
            
            username = os.path.splitext(json_file)[0]
            if 'username' not in user_profile:
                user_profile['username'] = username
                
            db_manager.save_user_profile(user_profile)
            
            print(f"Successfully migrated {json_file}")
            success_count += 1
            
        except Exception as e:
            print(f"Error migrating {json_file}: {str(e)}")
            error_count += 1
    
    print("\nMigration Summary:")
    print(f"Total profiles: {len(json_files)}")
    print(f"Successfully migrated: {success_count}")
    print(f"Failed: {error_count}")

if __name__ == "__main__":
    migrate_profiles()