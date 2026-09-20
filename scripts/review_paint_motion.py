"""Build readable contact strips for all compiled candidates; does not approve them."""
from pathlib import Path
import json
from PIL import Image,ImageDraw
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'generated/palimpsest/motion-v2')
reports=sorted(root.glob('*/motion.json'))
for group in range(0,len(reports),5):
    canvas=Image.new('RGB',(1000,5*210),'#202733');d=ImageDraw.Draw(canvas)
    for row,path in enumerate(reports[group:group+5]):
        report=json.loads(path.read_text());d.text((10,row*210+4),report['action'],fill='white')
        boxes=[Image.open(path.parent/f['file']).getbbox() for f in report['frames']]
        crop=(min(b[0] for b in boxes)-5,min(b[1] for b in boxes)-5,max(b[2] for b in boxes)+5,max(b[3] for b in boxes)+5)
        for col,i in enumerate([0,5,10,15,20]):
            im=Image.open(path.parent/report['frames'][i]['file']).crop(crop)
            # Fixed zoom across each strip retains deformation and scale.
            im.thumbnail((200,185));canvas.paste(im,(col*200,row*210+25),im)
    canvas.save(root/f'review-{group//5}.jpg')
