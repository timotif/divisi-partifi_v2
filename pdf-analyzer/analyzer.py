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

def example():
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

class Score:
	def __init__(self, path: str):
		self.path = path
		# TODO: Implement the logic to read the score from the PDF file
		self.pages: Page = []

class PageError(Exception):
    """Base exception for Page-related errors."""
    pass

class PageLoadError(PageError):
    """Raised when loading a page fails."""
    pass

class Page:
	def __init__(self, path: str, grayscale: bool = True):
		self.score: Score = None
		self.path = path
		self.staves: Staff = []
		self.img = self._load_image(grayscale)
		
	def _load_image(self, grayscale: bool):
		"""Load the image from the given path."""
		if not os.path.exists(self.path):
			raise PageLoadError(f"File not found: {self.path}")
		img = cv2.imread(self.path, cv2.IMREAD_GRAYSCALE) if grayscale else cv2.imread(self.path)
		if img is None:
			raise PageLoadError(f"Failed to load image: {self.path}")
		return img

class StaffError(Exception):
	"""Base exception for Staff-related errors."""
	pass
		
class Staff:
	def __init__(self, name: str, short_name: str, y: int, h: int, page: Page = None):
		self.page: Page = page
		self.score: Score = self.page.score if self.page else None
		self.name = name
		self.short_name = short_name
		self.y = y
		self.h = h
		self.img = self._crop()

	def _crop(self):
		if self.page is None:
			raise StaffError("Page not set for this staff.")
		x, w = (0, self.page.img.shape[1])
		y, h = (self.y, self.h)
		try:
			img = crop_image(self.page.img, x, y, w, h)
		except Exception as e:
			raise StaffError(f"Error cropping staff image: {e}")
		return img

class Part:
	def __init__(self, name: str, short_name: str, staves: list[Staff]):
		self.name = name
		self.short_name = short_name
		self.staves = staves
		self.pages = []

try:
	page = (Page("./img/music.png", grayscale=True))
	# show(page.img, "Page")
	page_wrong = (Page("./img/wrong", grayscale=False))
except PageLoadError as e:
	print(f"Error loading page: {e}")
names = ["flute", "piccolo", "English Horn"]
short_names = ["fl", "picc", "EH"]
assert len(names) == len(short_names), "Names and short names must have the same length"
name_idx = 0
parts = [] # will be a list attribute of the score
parts_dict = {} # will be a dict attribute of the score
h = 50
cuts = range(0, page.img.shape[0], h) # example cut positions all at the same distance
for cut in cuts:
	# Create a staff for each cut
	name = names[name_idx]
	short_name = short_names[name_idx]
	staff = Staff(name, short_name, cut, h, page)
	# Append the staff to the page
	page.staves.append(staff)
	# Add the staff to the right part
	# Check if the part already exists
	if name in parts_dict:
		part = parts_dict[name]
		# print(f"Adding staff {name} to existing part {part.name}")
	else:
		# Create a new part
		part = Part(name, short_name, [])
		parts_dict[name] = part
		parts.append(part)
		# print(f"Adding new part {name}")
	part.staves.append(staff)
	# Spin the name
	name_idx = (name_idx + 1) % len(names)

# for staff in page.staves:
# 	show(staff.img, staff.name)

for part in parts:
	print(f"Part: {part.name} has {len(part.staves)} staves")
	

# if __name__ == "__main__":
# 	example()