import os
import cv2
import numpy as np

def show(img, title="Image"):
	cv2.imshow(title, img)
	cv2.waitKey(0)
	cv2.destroyAllWindows()

def crop_image(image, x, y, w, h):
	# Crop the image using the provided coordinates
	return image[y:y+h, x:x+w]

staves_data = {} # Dictionary name: [y, h]
staves = {}

staves_data["fl"] = [100, 50]
staves_data["picc"] = [150, 40]
staves_data["EH"] = [190, 50]

img = cv2.imread("./img/music.png")
img_gray = cv2.imread("./img/music.png", cv2.IMREAD_GRAYSCALE)
for staff in staves_data:
	x, w = (0, img.shape[1])
	y, h = staves_data[staff]
	staves[staff] = crop_image(img_gray, x, y, w, h)
	show(staves[staff], staff)
