export interface Slide {
  id: string;
  title: string;
  content: string[];
  experiment?: {
    title: string;
    description: string;
    instructions: string[];
  };
  quiz?: {
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation?: string;
  }[];
  isTitleSlide?: boolean;
  video?: string;
}

export const SLIDES: Slide[] = [
  {
    id: 'title',
    title: 'Presentation about Jupiter',
    content: [
      'Created by: Bauke Oost',
      'Class: Grade 1'
    ],
    isTitleSlide: true
  },
  {
    id: 'inhoud',
    title: 'Table of Contents',
    content: [
      '1. What is Jupiter made of?',
      '2. The Great Red Spot (With experiment!)',
      '3. How far away is Jupiter?',
      '4. How old is Jupiter?',
      '5. Is Jupiter a normal planet? (With experiment!)',
      'Extra: Can we live there?',
      'Closing: The Big Jupiter Quiz!'
    ]
  },
  {
    id: 'h1',
    title: '1. What is Jupiter made of?',
    content: [
      '• No rock or sand like the Earth',
      '• Jupiter is a giant ball of gas!',
      '• 90% hydrogen and 10% helium',
      '• The atmosphere is at least 1000 km thick',
      '• You cannot land on it, because there is no solid ground'
    ]
  },
  {
    id: 'h2',
    title: '2. Where does the Red Spot come from?',
    content: [
      '• Not a volcano or an island',
      '• A giant storm (hurricane)',
      '• Has been raging for hundreds of years',
      '• Larger than the entire Earth!',
      '• Red color caused by solar radiation'
    ],
    video: 'Jupiter_red_dot_storm.mp4',
    experiment: {
      title: 'Make your own Red Spot!',
      description: 'Needed: Glass jar with water, spoon, red syrup or food coloring.',
      instructions: [
        'Stir hard with the spoon to create a vortex.',
        'Drop red coloring into the center.',
        'Watch how the spot keeps spinning!'
      ]
    }
  },
  {
    id: 'h3',
    title: '3. How far away is Jupiter?',
    content: [
      '• The distance is constantly changing!',
      '• Closest: 588 million km',
      '• Farthest: 968 million km',
      '• Light takes 33 to 54 minutes to travel',
      '• By car, it would take you hundreds of years to get there!'
    ]
  },
  {
    id: 'h4',
    title: '4. How old is Jupiter?',
    content: [
      '• About 4.5 billion years old!',
      '• The oldest planet in our solar system',
      '• Formed incredibly fast: within 1 million years',
      '• Made of gas and dust from space'
    ]
  },
  {
    id: 'h5',
    title: '5. Is Jupiter a normal planet?',
    content: [
      '• The largest planet — a gas giant!',
      '• More than 300× heavier than Earth',
      '• Rotates super fast on its axis',
      '• One day lasts only 9 hours and 55 minutes',
      '• You would weigh 2.5× more there than on Earth!'
    ],
    video: 'Jupiter_Size_Comparison_Video.mp4',
    experiment: {
      title: 'How heavy are you on Jupiter?',
      description: 'Needed: A bag with 1 kg of sugar, a bag with 2.5 kg of sugar.',
      instructions: [
        'Feel the 1 kg bag (your weight on Earth).',
        'Feel the 2.5 kg bag (your weight on Jupiter).',
        'The difference: You are more than twice as heavy on Jupiter!'
      ]
    }
  },
  {
    id: 'extra',
    title: 'Extra: Can we live on Jupiter?',
    content: [
      '• No! No solid ground, immense pressure, and extreme winds',
      '• But... Jupiter has 95 moons!',
      '• On the moon Europa, there might be an ocean under the ice',
      '• Jupiter pulls so hard on the moon Io that it heats up',
      '• Maybe life could be found there one day?'
    ]
  },
  {
    id: 'quiz',
    title: '🏆 The Big Jupiter Elimination Race!',
    content: [
      'Everyone stand up!',
      'Choose A (hands on your head) or B (hands behind your back).',
      'Wrong? Then you have to sit down!',
      'Who will be the last one standing?'
    ],
    quiz: [
      {
        question: '1. Which gases is Jupiter mostly made of?',
        options: ['A: Oxygen and Nitrogen', 'B: Hydrogen and Helium'],
        correctOptionIndex: 1,
        explanation: 'Just like the sun, Jupiter consists mainly of hydrogen and helium!'
      },
      {
        question: '2. What is the Great Red Spot?',
        options: ['A: A giant storm', 'B: A large volcano'],
        correctOptionIndex: 0,
        explanation: 'It is a storm that has been raging for hundreds of years and is larger than Earth!'
      },
      {
        question: '3. How long does a day on Jupiter last?',
        options: ['A: Almost 10 hours', 'B: Almost 24 hours'],
        correctOptionIndex: 0,
        explanation: 'Jupiter rotates super fast on its axis, so a day is very short.'
      },
      {
        question: '4. How many moons does Jupiter have (approximately)?',
        options: ['A: 1 (just like Earth)', 'B: 95'],
        correctOptionIndex: 1,
        explanation: 'Jupiter has enormous gravity and keeps as many as 95 moons in its orbit!'
      },
      {
        question: '5. Is Jupiter heavier or lighter than Earth?',
        options: ['A: More than 300× heavier', 'B: 10× lighter'],
        correctOptionIndex: 0,
        explanation: 'Jupiter is the heaviest planet in our entire solar system.'
      }
    ]
  },
  {
    id: 'afsluiting',
    title: 'The End',
    content: [
      'This was my presentation!',
      'Are there any questions?'
    ],
    isTitleSlide: true
  }
];