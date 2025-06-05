const { MongoClient } = require('mongodb');
require('dotenv').config();

class DatabaseManager {
  constructor() {
    this.uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.client = null;
    this.db = null;
  }

  async connect() {
    if (this.db) return this.db;
    
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db('language_assistant_db');
      console.log('Connected to MongoDB');
      return this.db;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

  async getUserProfile(username) {
    try {
      const db = await this.connect();
      const user = await db.collection('users').findOne({ username });
      
      if (!user) {
        return null;
      }
      
      const chatHistory = await db.collection('chat_messages')
        .find({ user_id: user._id })
        .sort({ timestamp: 1 })
        .toArray();
      
      const formattedHistory = [];
      for (let i = 0; i < chatHistory.length; i += 2) {
        if (i + 1 < chatHistory.length) {
          formattedHistory.push({
            user: chatHistory[i].content,
            ai: chatHistory[i + 1].content,
            timestamp: chatHistory[i].timestamp
          });
        }
      }
      
      const scenarios = await db.collection('custom_scenarios')
        .find({ user_id: user._id })
        .toArray();
      
      const formattedScenarios = scenarios.map(scenario => ({
        id: scenario.scenario_id,
        title: scenario.title,
        description: scenario.description,
        role: scenario.role,
        created_at: scenario.created_at
      }));
      
      return {
        username: user.username,
        ai_role: user.ai_role || "Virtual assistant AI.",
        language: user.language || "English",
        locale: user.locale || "en",
        scenario: user.scenario || "en",
        created_at: user.created_at,
        chat_history: formattedHistory,
        custom_scenarios: formattedScenarios
      };
    } catch (error) {
      console.error('Error getting user profile:', error);
      throw error;
    }
  }

  async createOrUpdateUser(userData) {
    try {
      const db = await this.connect();
      const { username } = userData;
      
      const existingUser = await db.collection('users').findOne({ username });
      
      if (existingUser) {
        await db.collection('users').updateOne(
          { username },
          { $set: {
            ai_role: userData.ai_role,
            language: userData.language,
            locale: userData.locale,
            scenario: userData.scenario
          }}
        );
        return existingUser._id;
      } else {
        const newUser = {
          username,
          created_at: userData.created_at || new Date().toISOString(),
          ai_role: userData.ai_role || "Virtual assistant AI.",
          language: userData.language || "English",
          locale: userData.locale || "en",
          scenario: userData.scenario || "en"
        };
        
        const result = await db.collection('users').insertOne(newUser);
        return result.insertedId;
      }
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw error;
    }
  }

  async saveConversation(username, conversation) {
    try {
      const db = await this.connect();
      
      const user = await db.collection('users').findOne({ username });
      if (!user) {
        throw new Error(`User ${username} not found`);
      }
      
      const chatMessages = [];
      
      for (const message of conversation) {
        const timestamp = message.timestamp || new Date().toISOString();
        
        if (message.user) {
          chatMessages.push({
            user_id: user._id,
            content: message.user,
            is_user: true,
            timestamp
          });
        }
        
        if (message.ai) {
          chatMessages.push({
            user_id: user._id,
            content: message.ai,
            is_user: false,
            audio_url: message.audio_url,
            timestamp
          });
        }
      }
      
      if (chatMessages.length > 0) {
        await db.collection('chat_messages').insertMany(chatMessages);
      }
      
      return true;
    } catch (error) {
      console.error('Error saving conversation:', error);
      throw error;
    }
  }

  async addCustomScenario(username, scenario) {
    try {
      const db = await this.connect();
      
      const user = await db.collection('users').findOne({ username });
      if (!user) {
        throw new Error(`User ${username} not found`);
      }
      
      const newScenario = {
        user_id: user._id,
        scenario_id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        role: scenario.role,
        created_at: scenario.created_at || new Date().toISOString()
      };
      
      await db.collection('custom_scenarios').insertOne(newScenario);
      return true;
    } catch (error) {
      console.error('Error adding custom scenario:', error);
      throw error;
    }
  }

  async migrateUserFromJson(jsonFilePath) {
    try {
      const fs = require('fs');
      const userData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
      
      const username = jsonFilePath.split('/').pop().split('.')[0];
      
      const user_id = await this.createOrUpdateUser({
        username,
        ...userData
      });
      
      if (userData.chat_history && userData.chat_history.length > 0) {
        const formattedConversation = userData.chat_history.map(msg => ({
          user: msg.user,
          ai: msg.ai,
          timestamp: msg.timestamp
        }));
        
        await this.saveConversation(username, formattedConversation);
      }
      
      if (userData.custom_scenarios && userData.custom_scenarios.length > 0) {
        for (const scenario of userData.custom_scenarios) {
          await this.addCustomScenario(username, scenario);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error migrating user from JSON:', error);
      throw error;
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log('MongoDB connection closed');
    }
  }
}

module.exports = DatabaseManager;