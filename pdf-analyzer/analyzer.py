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

def to_px(mm, dpi=300):
	"""Convert millimeters to pixels at the given DPI."""
	return int(mm * dpi / 25.4)

def to_mm(px, dpi=300):
	"""Convert pixels to millimeters at the given DPI."""
	return px * 25.4 / dpi

def create_blank_page(width, height):
	"""Create a blank page with the specified width and height."""
	return np.ones((height, width), dtype=np.uint8) * 255  # White page

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

class PartError(Exception):
	"""Base exception for Part-related errors."""
	pass

class PartLoadError(PartError):
	"""Raised when loading a part fails."""
	pass
class PartSaveError(PartError):
	"""Raised when saving a part fails."""
	pass

class Part:
	def __init__(self, name: str, short_name: str, staves: list[Staff]):
		self.name = name
		self.short_name = short_name
		self.staves: Staff = staves
		self.pages = []
		self.width = max([staff.img.shape[1] for staff in staves]) if staves else 0
		self.spacing = 0
	
	def _reset_y_pos(self):
		if not self.pages:
			return self.margins['top'] + self.title_area
		else:
			return self.margins['top']
	
	def _adapt_staff(self, staff: Staff):
		staff_height, staff_width = staff.img.shape[:2]
		scale_factor = min(1.0, self.available_width / staff_width)  # Don't upscale if image is smaller
   		# Calculate new dimensions
		new_width = int(staff_width * scale_factor)
		new_height = int(staff_height * scale_factor)
		# Resize the staff image
		if scale_factor != 1.0:
			staff_img_resized = cv2.resize(staff.img, (new_width, new_height))
		else:
			staff_img_resized = staff.img
		return staff_img_resized

	def _layout(self, page_format: str = "A4", dpi: int = 300):
		if page_format == "A4": # in mm
			width_mm, height_mm = 210, 297
			margins_mm = {'top': 20, 'bottom': 15, 'left': 15, 'right': 15}
			title_area_mm = 30  # Space for title on first page
			system_spacing_mm = 12  # Space between staves
			# Convert to pixels
			self.width = to_px(width_mm - margins_mm['left'] - margins_mm['right'], dpi)
			self.height = to_px(height_mm - margins_mm['top'] - margins_mm['bottom'], dpi)
			self.spacing = to_px(system_spacing_mm, dpi)
			self.title_area = to_px(title_area_mm, dpi)
			self.margins = {
				'top': to_px(margins_mm['top'], dpi),
				'bottom': to_px(margins_mm['bottom'], dpi),
				'left': to_px(margins_mm['left'], dpi),
				'right': to_px(margins_mm['right'], dpi)
			}
		else:
			raise ValueError(f"Unsupported page format: {page_format}")
		self.available_width = self.width - self.margins['left'] - self.margins['right']
		self.available_height = self.height - self.margins['top'] - self.margins['bottom']

	def process(self):
		self._layout(dpi=150)
		# Create a blank page with the specified dimensions
		page = create_blank_page(self.width, self.height)  # White page
		y_pos = self._reset_y_pos()
		for staff in self.staves:
			# Resize staff image to fit the page width respecting margins
			# staff_img_resized = cv2.resize(staff.img, (self.width - self.margins['left'] - self.margins['right'], staff.img.shape[0]))
			staff_img_resized = self._adapt_staff(staff)
			# Check that the resized image fits within the page
			if staff_img_resized.shape[1] > self.width - self.margins['left'] - self.margins['right']:
				raise PartError(f"Staff image width exceeds page width: {staff.name}")
			# Place the staff image on the page
			page[y_pos:y_pos + staff_img_resized.shape[0], self.margins['left']:self.margins['left'] + staff_img_resized.shape[1]] = staff_img_resized
			y_pos += staff_img_resized.shape[0] + self.spacing
			# If the page height is exceeded, create a new page
			if y_pos + staff_img_resized.shape[0] > self.height - self.margins['bottom']:
				self.pages.append(page)
				page = np.ones((self.height, self.width), dtype=np.uint8) * 255
				y_pos = self._reset_y_pos()
		self.pages.append(page)
		show(page, f"Part: {self.name}")

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
	part.process()

# if __name__ == "__main__":
# 	example()