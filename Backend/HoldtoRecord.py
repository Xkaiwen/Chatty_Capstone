import sounddevice as sd
import soundfile as sf
from pynput.keyboard import Key, Listener
import speech_recognition as sr
from deep_translator import GoogleTranslator
import wavio as wv
import time
import numpy as np
import tempfile
import queue
import sys

langdict = {'afrikaans': 'af', 'albanian': 'sq', 'amharic': 'am', 'arabic': 'ar', 'armenian': 'hy',
 'assamese': 'as', 'aymara': 'ay', 'azerbaijani': 'az', 'bambara': 'bm', 'basque': 'eu', 'belarusian': 'be',
  'bengali': 'bn', 'bhojpuri': 'bho', 'bosnian': 'bs', 'bulgarian': 'bg', 'catalan': 'ca', 'cebuano': 'ceb', 'chichewa': 'ny', 'chinese (simplified)': 'zh-CN', 'chinese (traditional)': 'zh-TW', 'corsican': 'co',
  'croatian': 'hr', 'czech': 'cs', 'danish': 'da', 'dhivehi': 'dv', 'dogri': 'doi', 'dutch': 'nl', 'english': 'en',
  'esperanto': 'eo', 'estonian': 'et', 'ewe': 'ee', 'filipino': 'tl', 'finnish': 'fi', 'french': 'fr',
  'frisian': 'fy', 'galician': 'gl', 'georgian': 'ka', 'german': 'de', 'greek': 'el', 'guarani': 'gn',
  'gujarati': 'gu', 'haitian creole': 'ht', 'hausa': 'ha', 'hawaiian': 'haw', 'hebrew': 'iw', 'hindi': 'hi',
  'hmong': 'hmn', 'hungarian': 'hu', 'icelandic': 'is', 'igbo': 'ig', 'ilocano': 'ilo', 'indonesian': 'id',
  'irish': 'ga', 'italian': 'it', 'japanese': 'ja', 'javanese': 'jw', 'kannada': 'kn', 'kazakh': 'kk',
  'khmer': 'km', 'kinyarwanda': 'rw', 'konkani': 'gom', 'korean': 'ko', 'krio': 'kri', 'kurdish (kurmanji)': 'ku',
  'kurdish (sorani)': 'ckb', 'kyrgyz': 'ky', 'lao': 'lo', 'latin': 'la', 'latvian': 'lv', 'lingala': 'ln',
  'lithuanian': 'lt', 'luganda': 'lg', 'luxembourgish': 'lb', 'macedonian': 'mk', 'maithili': 'mai',
  'malagasy': 'mg', 'malay': 'ms', 'malayalam': 'ml', 'maltese': 'mt', 'maori': 'mi', 'marathi': 'mr',
  'meiteilon (manipuri)': 'mni-Mtei', 'mizo': 'lus', 'mongolian': 'mn', 'myanmar': 'my', 'nepali': 'ne',
  'norwegian': 'no', 'odia (oriya)': 'or', 'oromo': 'om', 'pashto': 'ps', 'persian': 'fa', 'polish': 'pl',
  'portuguese': 'pt', 'punjabi': 'pa', 'quechua': 'qu', 'romanian': 'ro', 'russian': 'ru', 'samoan': 'sm',
  'sanskrit': 'sa', 'scots gaelic': 'gd', 'sepedi': 'nso', 'serbian': 'sr', 'sesotho': 'st', 'shona': 'sn',
  'sindhi': 'sd', 'sinhala': 'si', 'slovak': 'sk', 'slovenian': 'sl', 'somali': 'so', 'spanish': 'es',
  'sundanese': 'su', 'swahili': 'sw', 'swedish': 'sv', 'tajik': 'tg', 'tamil': 'ta', 'tatar': 'tt', 'telugu': 'te',
  'thai': 'th', 'tigrinya': 'ti', 'tsonga': 'ts', 'turkish': 'tr', 'turkmen': 'tk', 'twi': 'ak', 'ukrainian': 'uk',
  'urdu': 'ur', 'uyghur': 'ug', 'uzbek': 'uz', 'vietnamese': 'vi', 'welsh': 'cy', 'xhosa': 'xh', 'yiddish': 'yi',
  'yoruba': 'yo', 'zulu': 'zu'}

freq = 41400
channels = 1

def record_continue():
    #Setup Keyboard
    recording = False
    def on_press(key):
        nonlocal recording
        if key == Key.shift:
            recording = True
        
    
    def on_release(key):
        nonlocal recording
        if key == Key.shift:
            recording = False
    listener =Listener(on_press = on_press, on_release = on_release)
    listener.start()

    #Setup Audio
    q = queue.Queue()
    #Variables
    freq = 48000
    channels = 1
    
    def callback(indata, frames, time, status):
        """This is called (from a separate thread) for each audio block."""
        if status:
            print(status, file=sys.stderr)
        q.put(indata.copy())

    print("Hold shift to record. Release to end")
    while not recording:
        time.sleep(0.1)
    print("Recording now!")
    # Make sure the file is opened before recording anything:
    with sf.SoundFile('record.wav', mode='w', samplerate=freq, channels=1) as file: #mode 'w' truncates file
        with sd.InputStream(samplerate=freq, channels=1, callback=callback):
            print('#' * 80)
            print('Release shift to stop the recording')
            print('#' * 80)
            while recording:
                file.write(q.get())
        file.close()

     

if __name__ == "__main__":
    print("List of available languages" + str(list(langdict.keys())))
    original_lang = input("Type up source language ('french', 'english', etc.): ")
    translate_lang = input("Type up language to translate into('french', 'english', etc.): ")
    original_lang = langdict[original_lang]
    translate_lang = langdict[translate_lang]
    print(original_lang)
    print(translate_lang)

    record_continue()
    # Create an instance of the Recognizer class
    recognizer = sr.Recognizer()

    # Create audio file instance from the original file
    audio_ex = sr.AudioFile('record.wav')
    
    type(audio_ex)
    # Create audio data
    with audio_ex as source:
        audiodata = recognizer.record(audio_ex) 

    # Extract text
    try:
        text = recognizer.recognize_google(audio_data=audiodata, language=original_lang)
    except:
        print("Error: Can't recognize")
        exit()
    #https://cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
    #Refer to link for languages
    print("Original Text")
    print(text)


    translated = GoogleTranslator(source=original_lang, target=translate_lang).translate(text)
    print("Original to Target Translation:")
    print(translated)


    print("Translation from Original to Chinese")
    translated = GoogleTranslator(source=original_lang, target='zh-CN').translate(text)
    print(translated)