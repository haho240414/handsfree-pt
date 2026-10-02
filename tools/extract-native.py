"""Extract 15fps pose fixtures with the app's bundled full model (Python/CPU).

Validation media stay outside app/. GIFs use their actual single-cycle duration;
they are not repeated to inflate the number of observed repetitions.
"""
import argparse, bisect, hashlib, json, time, os
from pathlib import Path
import tempfile
os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir())/'hfpt-matplotlib-cache'))
import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageOps

p = argparse.ArgumentParser()
p.add_argument('file', type=Path)
p.add_argument('--name', required=True)
p.add_argument('--url', required=True)
p.add_argument('--fps', type=int, default=15)
p.add_argument('--review-dir', type=Path, default=Path('work/pose-review'))
a = p.parse_args()
repo = Path(__file__).resolve().parents[1]
model = repo / 'app/vendor/mediapipe/models/pose_landmarker_full.task'
out = repo / 'test/fixtures' / (a.name + '.full.json')
thumbs, frames = [], []
if a.file.suffix.lower() == '.gif':
    im = Image.open(a.file)
    images, ends, duration = [], [], 0
    for i in range(im.n_frames):
        im.seek(i)
        images.append(np.asarray(im.convert('RGB')).copy())
        duration += im.info.get('duration', 40) / 1000
        ends.append(duration)
    width, height = im.size
    def read(t): return images[min(len(images)-1, bisect.bisect_right(ends, t))]
else:
    cap = cv2.VideoCapture(str(a.file))
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS)
    def read(t):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, img = cap.read()
        if not ok: return None
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
options = mp.tasks.vision.PoseLandmarkerOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=str(model), delegate=mp.tasks.BaseOptions.Delegate.CPU),
    running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=1,
    min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
    min_tracking_confidence=0.5)
def pack(points): return [[round(v, 4) for v in (q.x,q.y,q.z,q.visibility)] for q in points]
start = time.monotonic()
with mp.tasks.vision.PoseLandmarker.create_from_options(options) as detector:
    for i in range(int(duration * a.fps)):
        t = i / a.fps
        img = read(t)
        if img is None: break
        result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(img)), round(t*1000))
        frames.append({'t':round(t,4),'lm':pack(result.pose_landmarks[0]) if result.pose_landmarks else None,
            'wl':pack(result.pose_world_landmarks[0]) if result.pose_world_landmarks else None})
        if i % max(1, a.fps // 2) == 0:
            thumbs.append((t,ImageOps.contain(Image.fromarray(img),(190,140))))
fx = {'name':a.name,'url':a.url,'fps':a.fps,'model':'full','duration':duration,'width':width,'height':height,
    'extraction':{'runtime':'MediaPipe Python/CPU','version':mp.__version__,'modelSHA256':hashlib.sha256(model.read_bytes()).hexdigest(),
        'gifCycles':1 if a.file.suffix.lower()=='.gif' else None},'ms':round((time.monotonic()-start)*1000),'frames':frames}
out.write_text(json.dumps(fx,separators=(',',':')))
# Review the original images and set truth before running the exercise engine.
sheet=Image.new('RGB',(1000,170*((len(thumbs)+4)//5)), 'white')
draw=ImageDraw.Draw(sheet)
for i,(t,img) in enumerate(thumbs):
    x,y=(i%5)*200,(i//5)*170
    sheet.paste(img,(x+(190-img.width)//2,y+20))
    draw.text((x+4,y+3),f'{t:.1f}s',fill='black')
a.review_dir.mkdir(parents=True, exist_ok=True)
sheet_path=a.review_dir/(a.name+'-review.png')
sheet.save(sheet_path)
print(json.dumps({'name':a.name,'duration':duration,'frames':len(frames),'detected':sum(f['lm'] is not None for f in frames),'review':str(sheet_path)}))
