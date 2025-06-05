const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const logApiCall = (method: string, endpoint: string, payload?: any) => {
  console.log(`API ${method} Request to: ${endpoint}`);
  if (payload) console.log('Payload:', JSON.stringify(payload));
};

const handleApiError = async (response: Response, context: string) => {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json();
      console.error(`API Error (${response.status}) in ${context}:`, errorData);
      return { error: errorData.detail || `${context} error: ${response.status}`, data: null };
    } else {
      const text = await response.text();
      console.error(`API Error (${response.status}) in ${context}:`, text);
      return { error: `${context} error: ${response.status}`, data: null };
    }
  } catch (e) {
    console.error(`Failed to parse error response in ${context}:`, e);
    return { error: `${context} failed with status: ${response.status}`, data: null };
  }
};

export interface PracticeSentenceRequest {
  language: string;
  difficulty: 'easy' | 'medium' | 'hard';
  username?: string;
}

export interface PracticeSentence {
  text: string;
  difficulty: string;
  audio_url?: string;
}

export interface SuggestionResponse {
  suggestions: string[];
}

export interface ChatResponse {
  message: string;
}

type APIResponse<T> = {
  data: T | null;
  error: string | null;
};

type ApiResult<T> = APIResponse<T>;

async function fetchAPI<T>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<APIResponse<T>> {
  try {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const error = await res.json();
      return { data: null, error: error.detail || 'An error occurred' };
    }

    const data = await res.json();
    return { data, error: null };
  } catch (error) {
    console.error('API Error:', error);
    return { data: null, error: 'Network error' };
  }
}

export const sendChatMessage = async (
  username: string,
  message: string,
  language: string = 'en',
  scenario?: string,
  response_locale?: string,
  conversation_id: string | null = null
): Promise<ApiResult<ChatResponse>> => {
  try {
    const response = await fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        message,
        scenario,
        language,
        user_locale: language,
        response_locale: response_locale || language,
        voice_locale: language,
        reset_language_context: false,
        force_language: false,
        save_to_history: true,
        is_discarded: false,
        conversation_id: conversation_id || null // Fix: Pass null if no ID is provided
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error: any) {
    console.error('Error sending chat message:', error);
    return { data: null, error: error.message };
  }
};

export const saveRoleplayMessage = async (
  username: string,
  scenarioTitle: string,
  message: string,
  isUserMessage: boolean,
  description?: string,
  language: string = 'en',
  audioUrl?: string
): Promise<ApiResult<any>> => {
  try {
    const response = await fetch('http://localhost:8000/api/save_scenario_message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        scenario_title: scenarioTitle,
        message: {
          role: isUserMessage ? 'user' : 'assistant',
          content: message,
          audio_url: audioUrl || null
        },
        description,
        language
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to save roleplay message: ${response.status}`, errorText);
      throw new Error(`Failed to save roleplay message: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      data,
      error: null
    };
  } catch (error) {
    console.error("Error saving roleplay message:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
};

export const getSuggestions = async (
  username: string,
  locale: string,
  debug: boolean = false,
  scenario?: string
): Promise<APIResponse<{ suggestions: string[] }>> => {
  try {
    if (debug) {
      console.log(`API call - getSuggestions: username=${username}, locale=${locale}, scenario=${scenario || 'not specified'}`);
    }
    
    const response = await fetch(`http://localhost:8000/api/get_suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username.trim(),
        locale: locale.trim(),
        scenario: scenario 
      }),
    });

    const responseText = await response.text();
    
    if (debug) {
      console.log(`API response (${response.status}): ${responseText}`);
    }
    
    if (!response.ok) {
      return {
        data: null,
        error: responseText || `API error: ${response.status}`
      };
    }
    
    try {
      const data = JSON.parse(responseText);
      return {
        data: data,
        error: null
      };
    } catch (e) {
      console.error("Failed to parse JSON response:", e);
      return {
        data: null,
        error: `Invalid JSON response: ${responseText}`
      };
    }
  } catch (error) {
    console.error("Network error in getSuggestions:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export async function getLanguageLessons(username: string) {
  return fetchAPI<{critique: string, lessons: string[]}>('/api/lesson', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export const setScenario = async (username: string, scenario: string, language: string, description: string) => {
  try {
    console.log(`Setting scenario: ${scenario} for user: ${username}`);
    const response = await fetch(`http://localhost:8000/api/set_scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        scenario,
        language,
        description
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return { error: `HTTP error! status: ${response.status}`, data: null };
    }
    
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { 
      data: null 
    };
  }
};

export const getScenarioResponse = async (username: string, language: string = 'en') => {
  try {
    if (!username) {
      console.error("Missing required username parameter");
      return { error: "Username is required", data: null };
    }
    const endpoint = `${API_BASE_URL}/api/get_scenario_response`;
    
    console.log(`Requesting scenario response at: ${endpoint}`);
    console.log(`With payload: ${JSON.stringify({ username, language })}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        username,
        language,
        message: "", 
        include_audio: true
      })
    });
    console.log(`Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      try {
        const errorData = JSON.parse(errorText);
        console.error(`API Error (${response.status}) in getScenarioResponse:`, errorData);
        
        if (response.status === 422 && errorData.detail) {
          console.error("Validation errors:", errorData.detail);
          const formattedErrors = errorData.detail.map((err: any) => 
            `Field '${err.loc.join('.')}': ${err.msg} (${err.type})`
          ).join('; ');
          return { error: formattedErrors, data: null };
        }
        
        return { error: errorData.detail || `HTTP error! status: ${response.status}`, data: null };
      } catch (e) {
        console.error(`Raw error response: ${errorText}`);
        return { error: `HTTP error! status: ${response.status}`, data: null };
      }
    }
    
    const data = await response.json();
    console.log("Scenario response data received:", data);
    return { data, error: null };
  } catch (error) {
    console.error("Error in getScenarioResponse:", error);
    return { 
      error: error instanceof Error ? error.message : "Unknown error in getScenarioResponse", 
      data: null 
    };
  }
};

export const deleteCustomScenario = async (username: string, scenarioId: string): Promise<ApiResult<any>> => {
  try {
    console.log(`API: Deleting scenario ${scenarioId} for user ${username}`);
    
    const response = await fetch(`http://localhost:8000/api/delete_custom_scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        scenario_id: scenarioId
      })
    });
    
    const responseData = await response.json();
    console.log("Delete API response:", responseData);
    
    if (!response.ok) {
      return { 
        error: responseData.error || `Server error: ${response.status}`, 
        data: null 
      };
    }
    
    return { 
      data: responseData, 
      error: null 
    };
  } catch (error) {
    console.error("Exception in deleteCustomScenario:", error);
    return { 
      error: error instanceof Error ? error.message : "Unknown error occurred during deletion", 
      data: null 
    };
  }
};

export const getUserProfile = async (username: string): Promise<ApiResult<any>> => {
  try {
    console.log(`API: Getting profile for user ${username}`);
    
    const response = await fetch(`http://localhost:8000/api/user_profile?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Profile API response status: ${response.status}`);
    const data = await response.json();
    console.log(`Profile API raw response:`, data);
    
    if (!response.ok) {
      return { 
        error: data.error || `HTTP error! status: ${response.status}`, 
        data: null 
      };
    }
    
    return { data, error: null };
  } catch (error) {
    console.error("Exception in getUserProfile:", error);
    return { 
      error: error instanceof Error ? error.message : "Unknown error", 
      data: null 
    };
  }
};

export async function getDefaultScenarios() {
  return fetchAPI<any>('/api/scenarios');
}

export const createCustomScenario = async (
  username: string,
  title: string,
  description: string
): Promise<ApiResult<any>> => {
  try {
    const response = await fetch('http://localhost:8000/api/save_user_scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        title,
        description,
        language: localStorage.getItem('locale') || 'en',
        timestamp: new Date().toISOString()
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error("Backend error creating custom scenario:", data);
      return { data: null, error: data.error || "Failed to create scenario" };
    }
    
    return { data, error: null };
  } catch (error) {
    console.error("Error creating custom scenario:", error);
    return { 
      data: null, 
      error: error instanceof Error ? error.message : "Network or server error" 
    };
  }
};

export const generatePracticeSentence = async (
  request: PracticeSentenceRequest
): Promise<ApiResult<PracticeSentence>> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/generate_practice_sentence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`API returned ${response.status}. Error: ${errorText}`);
      return { 
        data: null, 
        error: `Failed to fetch practice sentence: ${response.status}` 
      };
    }
    
    const data = await response.json();
    console.log("Backend returned practice sentence:", data);
    return { data, error: null };
  } catch (error) {
    console.error("Error fetching practice sentence:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to fetch practice sentence"
    };
  }
};

export const saveConversationToDatabase = async (
  username: string,
  messages: Array<{text: string, sender: 'user' | 'bot', audio_url?: string, english?: string}>
): Promise<ApiResult<any>> => {
  try {
    const formattedConversation = messages.reduce((result: any[], message, index) => {
      if (index % 2 === 0 && index + 1 < messages.length) {
        result.push({
          user: messages[index].text,
          ai: messages[index + 1].text,
          audio_url: messages[index + 1].audio_url,
          timestamp: new Date().toISOString()
        });
      }
      return result;
    }, []);

    console.log(`Saving conversation for user: ${username}`);
    
    const response = await fetch(`${API_BASE_URL}/api/save_conversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        conversation: formattedConversation
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error saving conversation: ${errorText}`);
      return { data: null, error: `Failed to save conversation: ${response.status}` };
    }
    
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.error("Error saving conversation:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to save conversation"
    };
  }
};

export const getConversationHistory = async (
  username: string
): Promise<ApiResult<{chat_history: Array<{user: string, ai: string, timestamp: string}>}>> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/conversation_history?username=${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching conversation history: ${errorText}`);
      return { data: null, error: `Failed to fetch conversation history: ${response.status}` };
    }
    
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.error("Error fetching conversation history:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Failed to fetch conversation history"
    };
  }
};

export const saveRoleplayConversation = async (
  username: string,
  scenario: string,
  conversation: any[],
  custom: boolean = false,
  language: string = 'en'
) => {
  try {
    const response = await fetch('http://localhost:8000/api/save_roleplay_conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        scenario,
        conversation,
        custom,
        language,
        timestamp: new Date().toISOString()
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return { error: data.message || 'Failed to save roleplay conversation' };
    }
    
    return { data };
  } catch (error) {
    console.error('API error in saveRoleplayConversation:', error);
    return { error: 'Network error while saving roleplay conversation' };
  }
};

export const saveUserScenario = async (
  username: string,
  title: string,
  description: string,
  language: string = 'en'
) => {
  try {
    const response = await fetch('http://localhost:8000/api/save_user_scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        title,
        description,
        language,
        timestamp: new Date().toISOString()
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return { error: data.message || 'Failed to save user scenario' };
    }
    
    return { data };
  } catch (error) {
    console.error('API error in saveUserScenario:', error);
    return { error: 'Network error while saving user scenario' };
  }
};

export const getUserScenarios = async (username: string) => {
  try {
    const response = await fetch(`http://localhost:8000/api/user_scenarios?username=${username}`);
    
    const data = await response.json();
    
    if (!response.ok) {
      return { error: data.message || 'Failed to fetch user scenarios' };
    }
    
    return { data };
  } catch (error) {
    console.error('API error in getUserScenarios:', error);
    return { error: 'Network error while fetching user scenarios' };
  }
};

export const checkExistingScenario = async (username: string, title: string) => {
  try {
    console.log(`Checking if scenario '${title}' exists for user '${username}'`);
    
    if (!username || !title) {
      console.error('Missing required parameters: username and title must be provided');
      return { exists: false, error: 'Missing username or title' };
    }
    
    const response = await fetch('http://localhost:8000/api/check_existing_scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        title,
      }),
    });

    console.log(`Check scenario response status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`Server error: ${response.status}`);
      throw new Error(`Server responded with status: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Check existing scenario response:`, data);
    
    return { 
      exists: Boolean(data.exists), 
      error: data.error || null
    };
  } catch (error) {
    console.error('Error checking existing scenario:', error);
    return { error: 'Failed to check for existing scenarios', exists: false };
  }
};

export const saveScenarioConversation = async (
  conversationData: {
    username: string;
    scenario_title: string;
    description: string;
    language: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      audio_url?: string | null;
    }>;
    timestamp: string;
  }
): Promise<ApiResult<any>> => {
  try {
    console.log("Saving scenario conversation to database:", conversationData);
    
    const response = await fetch(`${API_BASE_URL}/api/save_scenario_conversation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(conversationData)
    });
    
    const responseText = await response.text();
    console.log(`Raw API response (${response.status}):`, responseText);
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error("Response is not valid JSON:", e);
      if (!response.ok) {
        return { 
          error: `HTTP error! status: ${response.status} - ${responseText}`, 
          data: null 
        };
      }
    }
    
    if (!response.ok) {
      return { 
        error: responseData?.detail || `HTTP error! status: ${response.status}`, 
        data: null 
      };
    }
    
    return { data: responseData, error: null };
  } catch (error) {
    console.error("Error in saveScenarioConversation:", error);
    return { 
      error: error instanceof Error ? error.message : "Unknown error saving conversation", 
      data: null 
    };
  }
};