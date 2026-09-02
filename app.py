from flask import Flask, render_template, request, redirect, url_for, Response
import cv2
import numpy as np
import mediapipe as mp
import tensorflow as tf

app = Flask(__name__)

mp_holistic = mp.solutions.holistic  # Holistic model
mp_drawing = mp.solutions.drawing_utils  # Drawing utilities

# Initialize your model here
model = tf.keras.models.load_model('9mots500.h5')
actions = np.array(['Bonjour','Bravo','Ca va','Non','Oui','Au revoir','Pardon','Stp','Bien','Pas bien'])
sequence = []
sentence = []
threshold = 0.8

def mediapipe_detection(image, model):
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)  # Convert BGR to RGB
    image.flags.writeable = False  # Image is not writeable
    results = model.process(image)  # Make prediction
    image.flags.writeable = True  # Image is now writeable
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)  # Convert back to BGR
    return image, results

def draw_styled_landmarks(image, results):
    # Draw face landmarks
    mp_drawing.draw_landmarks(
        image, results.face_landmarks, mp_holistic.FACEMESH_TESSELATION,
        mp_drawing.DrawingSpec(color=(80, 110, 10), thickness=1, circle_radius=1),
        mp_drawing.DrawingSpec(color=(80, 256, 121), thickness=1, circle_radius=1)
    )
    # Draw pose landmarks
    mp_drawing.draw_landmarks(
        image, results.pose_landmarks, mp_holistic.POSE_CONNECTIONS,
        mp_drawing.DrawingSpec(color=(80, 22, 10), thickness=2, circle_radius=4),
        mp_drawing.DrawingSpec(color=(80, 44, 121), thickness=2, circle_radius=2)
    )
    # Draw left hand landmarks
    mp_drawing.draw_landmarks(
        image, results.left_hand_landmarks, mp_holistic.HAND_CONNECTIONS,
        mp_drawing.DrawingSpec(color=(121, 22, 76), thickness=2, circle_radius=4),
        mp_drawing.DrawingSpec(color=(121, 44, 250), thickness=2, circle_radius=2)
    )
    # Draw right hand landmarks
    mp_drawing.draw_landmarks(
        image, results.right_hand_landmarks, mp_holistic.HAND_CONNECTIONS,
        mp_drawing.DrawingSpec(color=(245, 117, 66), thickness=2, circle_radius=4),
        mp_drawing.DrawingSpec(color=(245, 66, 230), thickness=2, circle_radius=2)
    )

def extract_keypoints(results):
    pose = np.array([[res.x, res.y, res.z, res.visibility] for res in results.pose_landmarks.landmark]).flatten() if results.pose_landmarks else np.zeros(33*4)
    face = np.array([[res.x, res.y, res.z] for res in results.face_landmarks.landmark]).flatten() if results.face_landmarks else np.zeros(468*3)
    lh = np.array([[res.x, res.y, res.z] for res in results.left_hand_landmarks.landmark]).flatten() if results.left_hand_landmarks else np.zeros(21*3)
    rh = np.array([[res.x, res.y, res.z] for res in results.right_hand_landmarks.landmark]).flatten() if results.right_hand_landmarks else np.zeros(21*3)
    return np.concatenate([pose, face, lh, rh])

def gen_frames():  # generate frame by frame from camera
    global sequence, sentence  # Use the global variables

    cap = cv2.VideoCapture(0)
    with mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5) as holistic:
        while True:
            success, frame = cap.read()
            if not success:
                break
            else:
                image, results = mediapipe_detection(frame, holistic)
                print(results)

                draw_styled_landmarks(image, results)

                # Prediction logic
                keypoints = extract_keypoints(results)
                sequence.append(keypoints)
                sequence = sequence[-30:]

                if len(sequence) == 30:
                    # Predict here
                    res = model.predict(np.expand_dims(sequence, axis=0))[0]
                    print(actions[np.argmax(res)])

                    if res[np.argmax(res)] > threshold:
                        if len(sentence) > 0:
                            if actions[np.argmax(res)] != sentence[-1]:
                                sentence=(actions[np.argmax(res)])
                        else:
                            sentence=(actions[np.argmax(res)])

                cv2.rectangle(image, (850, 100), (400, 0), (255, 255, 255), -1)
                cv2.putText(image, ' '.join(sentence), (550, 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2, cv2.LINE_AA)

                ret, buffer = cv2.imencode('.jpg', image)
                frame = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')  # concat frame one by one and show result

    cap.release()
    cv2.destroyAllWindows()

def gen_frames2():  # generate frame by frame from camera
    global sequence, sentence  # Use the global variables

    cap = cv2.VideoCapture(0)
    with mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5) as holistic:
        while True:
            # Afficher le message pour l'utilisateur
            ret, frame = cap.read()
            if not ret:
                break

            #cv2.waitKey(3000)  # Afficher la traduction pendant 2 secondes
            cv2.putText(frame, 'Faites un signe', (120, 200), 
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 4, cv2.LINE_AA)


            # Convertir le frame pour Flask
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')  # concat frame one by one and show result

            # Attendre 2 secondes pour que l'utilisateur fasse un signe
            cv2.waitKey(2000)  

            # Lire les frames et faire des prédictions
            sequence = []
            for frame_num in range(30):
                ret, frame = cap.read()
                if not ret:
                    break

                # Faire des détections
                image, results = mediapipe_detection(frame, holistic)
                
                # Dessiner les points de repère
                draw_styled_landmarks(image, results)
                
                # Extraire les points clés
                keypoints = extract_keypoints(results)
                sequence.append(keypoints)

                # Convertir le frame pour Flask
                ret, buffer = cv2.imencode('.jpg', image)
                frame = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')  # concat frame one by one and show result

                # Arrêter proprement
                if cv2.waitKey(10) & 0xFF == ord('q'):
                    break

            # Prédiction du modèle
            if len(sequence) == 30:
                res = model.predict(np.expand_dims(sequence, axis=0))[0]
                print(actions[np.argmax(res)])
                
                if res[np.argmax(res)] > threshold:
                    if len(sentence) > 0:
                        if actions[np.argmax(res)] != sentence[-1]:
                            sentence = [actions[np.argmax(res)]]
                    else:
                        sentence = [actions[np.argmax(res)]]

            # Affichage des résultats
            ret, frame = cap.read()
            if not ret:
                break
            cv2.rectangle(frame, (0, 0), (640, 40), (255, 255, 255), -1)
            cv2.putText(frame, ' '.join(sentence), (3, 30), 
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2, cv2.LINE_AA)

            # Convertir le frame pour Flask
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')  # concat frame one by one and show result
            cv2.waitKey(2000)  # Afficher la traduction pendant 2 secondes

            
            
    cap.release()
    cv2.destroyAllWindows()


@app.route('/')
def home():
    return render_template('index.html')

@app.route('/test')
def new_page():
    return Response(gen_frames2(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/traduction')
def traduction():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/avis', methods=['GET', 'POST'])
def avis():
    if request.method == 'POST':
        return redirect(url_for('home'))
    return render_template('avis.html')

@app.route('/reglages', methods=['GET', 'POST'])
def reglages():
    if request.method == 'POST':
        return redirect(url_for('reglages'))
    return render_template('reglages.html')

@app.route('/politique')
def politique():
    return render_template('politique.html')

@app.route('/support')
def support():
    return redirect(url_for('home'))

@app.route('/tutorial')
def tutorial():
    return redirect(url_for('home'))

@app.route('/edit_profile')
def edit_profile():
    return redirect(url_for('home'))

@app.route('/change_password')
def change_password():
    return redirect(url_for('home'))

@app.route('/logout')
def logout():
    return redirect(url_for('home'))

if __name__ == '__main__':
    app.run(debug=False, port=5000)
