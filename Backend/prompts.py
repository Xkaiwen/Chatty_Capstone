DEFAULT_SCENARIOS = {
    "restaurant": {
        "English": {"desc": "The user is in a restaurant ordering food.", "role": "A waiter"},
        "Chinese (Simplified)": {"desc": "用户正在餐厅点餐。", "role": "服务员"},
        "Chinese (Traditional)": {"desc": "使用者正在餐廳點餐。", "role": "服務員"},
        "Japanese": {"desc": "ユーザーはレストランで食べ物を注文しています。", "role": "ウェイター"},
        "Korean": {"desc": "사용자가 레스토랑에서 음식을 주문하고 있습니다.", "role": "웨이터"},
        "Spanish": {"desc": "El usuario está en un restaurante pidiendo comida.", "role": "Un camarero"},
        "French": {"desc": "L'utilisateur est dans un restaurant en train de commander de la nourriture.", "role": "Un serveur"},
        "German": {"desc": "Der Benutzer ist in einem Restaurant und bestellt Essen.", "role": "Ein Kellner"},
        "Italian": {"desc": "L'utente è in un ristorante a ordinare cibo.", "role": "Un cameriere"},
        "Hindi": {"desc": "उपयोगकर्ता एक रेस्तरां में भोजन का ऑर्डर दे रहा है।", "role": "एक वेटर"}
    },
    "job_interview": {
        "English": {"desc": "The user is in a job interview for a software engineering position.", "role": "An interviewer"},
        "Chinese": {"desc": "用户正在面试软件工程师职位。", "role": "面试官"},
        "Japanese": {"desc": "ユーザーはソフトウェアエンジニアの職務面接を受けています。", "role": "面接官"},
        "Korean": {"desc": "사용자가 소프트웨어 엔지니어 직무 면접을 보고 있습니다.", "role": "면접관"},
        "Spanish": {"desc": "El usuario está en una entrevista de trabajo para un puesto de ingeniero de software.", "role": "Un entrevistador"},
        "French": {"desc": "L'utilisateur est en entretien d'embauche pour un poste d'ingénieur logiciel.", "role": "Un recruteur"},
        "German": {"desc": "Der Benutzer ist in einem Vorstellungsgespräch für eine Stelle als Softwareentwickler.", "role": "Ein Interviewer"},
        "Italian": {"desc": "L'utente è in un colloquio di lavoro per una posizione di ingegnere software.", "role": "Un intervistatore"},
        "Hindi": {"desc": "उपयोगकर्ता सॉफ़्टवेयर इंजीनियर की स्थिति के लिए नौकरी साक्षात्कार में है।", "role": "एक साक्षात्कारकर्ता"}
    },
    "travel": {
        "English": {"desc": "The user is at an airport checking in for a flight.", "role": "A check-in agent"},
        "Chinese": {"desc": "用户正在机场办理登机手续。", "role": "值机员"},
        "Japanese": {"desc": "ユーザーは空港で搭乗手続きをしています。", "role": "チェックイン係員"},
        "Korean": {"desc": "사용자가 공항에서 비행기 탑승 수속을 하고 있습니다.", "role": "체크인 직원"},
        "Spanish": {"desc": "El usuario está en un aeropuerto haciendo el check-in para un vuelo.", "role": "Un agente de facturación"},
        "French": {"desc": "L'utilisateur est à l'aéroport en train de s'enregistrer pour un vol.", "role": "Un agent d'enregistrement"},
        "German": {"desc": "Der Benutzer ist am Flughafen und checkt für einen Flug ein.", "role": "Ein Check-in-Agent"},
        "Italian": {"desc": "L'utente è in un aeroporto per il check-in di un volo.", "role": "Un agente di check-in"},
        "Hindi": {"desc": "उपयोगकर्ता हवाई अड्डे पर उड़ान के लिए चेक-इन कर रहा है।", "role": "एक चेक-इन एजेंट"}
    }
}

PROFILE_DIR = "user_profiles"
SOUND_RESPONSE_DIR = "sound_responses"

LANGUAGE_MAP = {
    'English': 'en',
    'Chinese': 'zh',
    'Japanese': 'ja'
}